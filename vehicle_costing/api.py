
import frappe
from frappe.utils import add_days, flt, get_datetime, getdate, now_datetime, today, time_diff_in_hours


def _resolve_billable_days(reference_time, out_time):
    if not out_time:
        return 0
    if isinstance(reference_time, str):
        reference_time = get_datetime(reference_time)
    if isinstance(out_time, str):
        out_time = get_datetime(out_time)
    return (getdate(reference_time) - getdate(out_time)).days + 1


def _get_allowed_hubs(user=None):
    user = user or frappe.session.user
    if user == "Guest":
        frappe.throw("Please log in to access the dashboard.")

    if user == "Administrator":
        hubs = frappe.db.get_all(
            "Hub User Mapping",
            filters={"enabled": 1},
            pluck="hub_name",
            distinct=True,
        )
        return sorted({hub for hub in hubs if hub})

    hubs = frappe.db.get_all(
        "Hub User Mapping",
        filters={"user": user, "enabled": 1},
        pluck="hub_name",
        distinct=True,
    )

    if not hubs:
        frappe.throw("No active hub is assigned to your user.")

    return sorted({hub for hub in hubs if hub})


def _coerce_date(date_value, fallback=None):
    if not date_value:
        return fallback
    try:
        return getdate(date_value)
    except Exception:
        return fallback


def _safe_float(value):
    try:
        return flt(value)
    except Exception:
        return 0.0


@frappe.whitelist()
def scan_vehicle(qr_token):
    if frappe.session.user == "Guest":
        frappe.throw("Please log in before scanning.")

    if not qr_token:
        frappe.throw("QR token is required.")

    vehicle_name = frappe.db.get_value(
        "Vehicle Master",
        {"qr_token": qr_token, "active": 1},
        "name",
    )

    if not vehicle_name:
        frappe.throw("Invalid QR code or inactive vehicle.")

    frappe.db.sql(
        """
        SELECT name
        FROM `tabVehicle Master`
        WHERE name = %s
        FOR UPDATE
        """,
        vehicle_name,
    )

    vehicle = frappe.get_doc("Vehicle Master", vehicle_name)

    mapping = frappe.db.get_value(
        "Hub User Mapping",
        {"user": frappe.session.user, "enabled": 1},
        ["hub_name"],
        as_dict=True,
    )

    if not mapping:
        frappe.throw("No active hub is assigned to your user.")

    now = now_datetime()

    # Lock matching open visit rows before reading/updating them. Locking only
    # Vehicle Master is not enough if another request updates the visit log.
    # Keep the row lock until this request completes so simultaneous scans do
    # not both attempt to close the same visit.
    open_visit_rows = frappe.db.sql(
        """
        SELECT name
        FROM `tabVehicle Visit Log`
        WHERE vehicle = %s
          AND status = 'Open'
          AND out_time IS NOT NULL
          AND (in_time IS NULL OR in_time = '')
        ORDER BY out_time DESC
        LIMIT 2
        FOR UPDATE
        """,
        (vehicle.name,),
        as_dict=True,
    )

    open_visits = []
    for row in open_visit_rows:
        data = frappe.db.get_value(
            "Vehicle Visit Log",
            row.name,
            ["name", "out_time", "daily_rate", "hub_name"],
            as_dict=True,
        )
        if data:
            open_visits.append(data)

    if len(open_visits) > 1:
        frappe.throw(
            "Multiple open visits exist for this vehicle. "
            "Resolve the duplicate records before scanning."
        )

    open_visit = open_visits[0] if open_visits else None

    if open_visit:
        # Vehicle Visit Log is the source of truth. A very recent open visit
        # usually means the OUT request was submitted twice by the browser.
        # Return a normal response (not frappe.throw/HTTP 417) and leave the
        # visit open. This prevents a duplicate request from immediately
        # turning the newly created OUT visit into an IN visit.
        elapsed_hours = time_diff_in_hours(now, open_visit.out_time)
        if elapsed_hours < (1 / 60):
            return {
                "action": "DUPLICATE",
                "vehicle": vehicle.vehicle_number,
                "hub": open_visit.hub_name,
                "timestamp": str(now),
                "visit": open_visit.name,
                "message": "Recent OUT scan is already recorded. No additional entry was created.",
            }

        billable_days = _resolve_billable_days(now, open_visit.out_time)
        rate = open_visit.daily_rate if open_visit.daily_rate is not None else vehicle.daily_rate
        cost = billable_days * rate

        visit = frappe.get_doc("Vehicle Visit Log", open_visit.name)
        visit.in_time = now
        visit.billable_days = billable_days
        visit.estimated_cost = cost
        visit.final_cost = cost
        visit.status = "Completed"
        visit.save(ignore_permissions=True)

        # Vehicle Visit Log is the source of truth for IN/OUT. Do not save
        # Vehicle Master here: Vehicle Visit Log hooks may already update it,
        # causing a Frappe TimestampMismatchError on a second save.
        frappe.db.commit()

        return {
            "action": "IN",
            "vehicle": vehicle.vehicle_number,
            "hub": open_visit.hub_name,
            "timestamp": str(now),
            "billable_days": billable_days,
            "final_cost": cost,
            "message": "Vehicle IN recorded successfully.",
        }

    # No open visit means the next valid scan is OUT. Vehicle Master state is
    # updated below as a mirror, but it does not decide IN/OUT.

    visit = frappe.get_doc(
        {
            "doctype": "Vehicle Visit Log",
            "vehicle": vehicle.name,
            "hub_name": mapping.hub_name,
            "out_time": now,
            "daily_rate": vehicle.daily_rate,
            "status": "Open",
        }
    )
    visit.insert(ignore_permissions=True)

    # Vehicle Visit Log is the source of truth for IN/OUT. Do not save
    # Vehicle Master here: Visit Log hooks may already update it. Avoiding a
    # second Vehicle Master save prevents the timestamp conflict.
    frappe.db.commit()

    return {
        "action": "OUT",
        "vehicle": vehicle.vehicle_number,
        "hub": mapping.hub_name,
        "timestamp": str(now),
        "message": "Vehicle OUT recorded successfully.",
    }


@frappe.whitelist()
def get_open_vehicle_visits(hub_name=None, vehicle_type=None):
    if frappe.session.user == "Guest":
        frappe.throw("Please log in to view open vehicle visits.")

    allowed_hubs = _get_allowed_hubs()
    if hub_name:
        if hub_name not in allowed_hubs:
            frappe.throw("You do not have permission to access the selected hub.")
        allowed_hubs = [hub_name]

    now = now_datetime()
    filters = {
        "status": "Open",
        "out_time": ["is", "set"],
        "in_time": ["is", "not set"],
    }
    if allowed_hubs:
        filters["hub_name"] = ["in", allowed_hubs]

    visits = frappe.get_all(
        "Vehicle Visit Log",
        filters=filters,
        fields=[
            "name",
            "vehicle",
            "hub_name",
            "out_time",
            "daily_rate",
            "billable_days",
            "estimated_cost",
            "status",
        ],
        order_by="out_time desc",
        limit_page_length=500,
    )

    vehicle_names = {visit["vehicle"] for visit in visits if visit.get("vehicle")}
    vehicle_map = {}
    if vehicle_names:
        records = frappe.get_all(
            "Vehicle Master",
            filters={"name": ["in", list(vehicle_names)]},
            fields=["name", "vehicle_number", "vehicle_type", "daily_rate"],
        )
        vehicle_map = {record["name"]: record for record in records}

    for visit in visits:
        vehicle = vehicle_map.get(visit.get("vehicle"), {})
        visit["vehicle_number"] = vehicle.get("vehicle_number") or visit.get("vehicle")
        visit["vehicle_type"] = vehicle.get("vehicle_type")
        visit["daily_rate"] = visit.get("daily_rate") if visit.get("daily_rate") is not None else (vehicle.get("daily_rate") or 0)
        visit["billable_days"] = _resolve_billable_days(now, visit.get("out_time"))
        visit["estimated_cost"] = visit["billable_days"] * visit["daily_rate"]
        visit["status"] = visit.get("status") or "Open"

    if vehicle_type:
        visits = [visit for visit in visits if (visit.get("vehicle_type") or "") == vehicle_type]

    return visits


@frappe.whitelist()
def get_vehicle_dashboard_data(hub_name=None, from_date=None, to_date=None, vehicle_type=None):
    if frappe.session.user == "Guest":
        frappe.throw("Please log in to access the dashboard.")

    allowed_hubs = _get_allowed_hubs()
    if hub_name:
        if hub_name not in allowed_hubs:
            frappe.throw("You do not have permission to access the selected hub.")
        allowed_hubs = [hub_name]

    selected_to_date = _coerce_date(to_date, today())
    selected_from_date = _coerce_date(from_date, add_days(selected_to_date, -30))

    open_filters = {
        "status": "Open",
        "out_time": ["is", "set"],
        "in_time": ["is", "not set"],
    }
    if allowed_hubs:
        open_filters["hub_name"] = ["in", allowed_hubs]

    open_visits = frappe.get_all(
        "Vehicle Visit Log",
        filters=open_filters,
        fields=["name", "vehicle", "hub_name", "out_time", "daily_rate", "estimated_cost", "status"],
        order_by="out_time desc",
    )

    vehicle_names = {visit.get("vehicle") for visit in open_visits if visit.get("vehicle")}
    vehicle_map = {}
    if vehicle_names:
        records = frappe.get_all(
            "Vehicle Master",
            filters={"name": ["in", list(vehicle_names)]},
            fields=["name", "vehicle_number", "vehicle_type", "daily_rate"],
        )
        vehicle_map = {record["name"]: record for record in records}

    enriched_open_visits = []
    total_open_exposure = 0.0
    for visit in open_visits:
        vehicle = vehicle_map.get(visit.get("vehicle"), {})
        daily_rate = visit.get("daily_rate") if visit.get("daily_rate") is not None else (vehicle.get("daily_rate") or 0)
        billable_days = _resolve_billable_days(now_datetime(), visit.get("out_time"))
        estimated_cost = billable_days * daily_rate
        if visit.get("estimated_cost") is not None:
            estimated_cost = _safe_float(visit.get("estimated_cost"))
        total_open_exposure += estimated_cost
        item = {
            "name": visit.get("name"),
            "vehicle": visit.get("vehicle"),
            "vehicle_number": vehicle.get("vehicle_number") or visit.get("vehicle"),
            "vehicle_type": vehicle.get("vehicle_type"),
            "hub_name": visit.get("hub_name"),
            "out_time": visit.get("out_time"),
            "daily_rate": daily_rate,
            "billable_days": billable_days,
            "estimated_cost": estimated_cost,
            "status": visit.get("status") or "Open",
        }
        if vehicle_type and item["vehicle_type"] != vehicle_type:
            continue
        enriched_open_visits.append(item)

    active_fleet_count = len(
        frappe.get_all(
            "Vehicle Master",
            filters={"active": 1},
            fields=["name"],
            limit_page_length=500,
        )
    )
    if allowed_hubs and len(allowed_hubs) == 1:
        active_fleet_count = len({
            v["vehicle"]
            for v in frappe.get_all(
                "Vehicle Visit Log",
                filters={"hub_name": ["in", allowed_hubs], "status": ["in", ["Open", "Completed"]]},
                fields=["vehicle"],
                limit_page_length=500,
            )
            if v.get("vehicle")
        })

    vehicles_out = len(enriched_open_visits)
    vehicles_inside = max(active_fleet_count - vehicles_out, 0)

    completed_filters = {"status": "Completed", "in_time": ["between", [selected_from_date, selected_to_date]]}
    if allowed_hubs:
        completed_filters["hub_name"] = ["in", allowed_hubs]
    if vehicle_type:
        vehicle_names_by_type = frappe.get_all(
            "Vehicle Master",
            filters={"vehicle_type": vehicle_type},
            fields=["name"],
        )
        vehicle_names_by_type = [record["name"] for record in vehicle_names_by_type]
        if not vehicle_names_by_type:
            vehicle_names_by_type = [""]
        completed_filters["vehicle"] = ["in", vehicle_names_by_type]

    completed_visits = frappe.get_all(
        "Vehicle Visit Log",
        filters=completed_filters,
        fields=["name", "vehicle", "hub_name", "out_time", "in_time", "daily_rate", "final_cost", "billable_days", "estimated_cost"],
    )

    completed_cost = sum(_safe_float(visit.get("final_cost") or visit.get("estimated_cost") or 0) for visit in completed_visits)

    today_count = now_datetime().date()
    today_out_filters = {"status": "Open", "out_time": [">=", today_count.strftime("%Y-%m-%d 00:00:00")]}
    if allowed_hubs:
        today_out_filters["hub_name"] = ["in", allowed_hubs]
    today_out = frappe.db.count("Vehicle Visit Log", filters=today_out_filters)

    today_in_filters = {"status": "Completed", "in_time": [">=", today_count.strftime("%Y-%m-%d 00:00:00")]}
    if allowed_hubs:
        today_in_filters["hub_name"] = ["in", allowed_hubs]
    today_in = frappe.db.count("Vehicle Visit Log", filters=today_in_filters)

    movement_rows = []
    current_date = selected_from_date
    while current_date <= selected_to_date:
        date_key = current_date.strftime("%Y-%m-%d")
        date_start = f"{date_key} 00:00:00"
        date_end = f"{date_key} 23:59:59"

        out_filters = {"status": "Open", "out_time": ["between", [date_start, date_end]]}
        if allowed_hubs:
            out_filters["hub_name"] = ["in", allowed_hubs]
        out_count = frappe.db.count("Vehicle Visit Log", filters=out_filters)

        in_filters = {"status": "Completed", "in_time": ["between", [date_start, date_end]]}
        if allowed_hubs:
            in_filters["hub_name"] = ["in", allowed_hubs]
        in_count = frappe.db.count("Vehicle Visit Log", filters=in_filters)

        movement_rows.append({"date": date_key, "out_count": out_count, "in_count": in_count})
        current_date = add_days(current_date, 1)

    hub_summary = []
    hub_names = allowed_hubs or frappe.db.get_all("Hub User Mapping", filters={"enabled": 1}, pluck="hub_name", distinct=True)
    seen_hubs = set()
    for hub in sorted(set(hub_names)):
        if hub in seen_hubs:
            continue
        seen_hubs.add(hub)
        hub_open_visits = [item for item in enriched_open_visits if item.get("hub_name") == hub]
        hub_completed = [visit for visit in completed_visits if visit.get("hub_name") == hub]
        avg_billable_days = 0.0
        if hub_completed:
            avg_billable_days = sum(_safe_float(visit.get("billable_days") or 0) for visit in hub_completed) / len(hub_completed)
        hub_summary.append({
            "hub_name": hub,
            "vehicles_out": len(hub_open_visits),
            "active_fleet_count": len({visit.get("vehicle") for visit in hub_completed + hub_open_visits if visit.get("vehicle")}),
            "current_exposure": sum(_safe_float(item.get("estimated_cost") or 0) for item in hub_open_visits),
            "completed_visit_cost": sum(_safe_float(visit.get("final_cost") or visit.get("estimated_cost") or 0) for visit in hub_completed),
            "avg_billable_days": avg_billable_days,
        })

    exceptions = []
    open_visit_group = {}
    for item in enriched_open_visits:
        duplicate_key = item.get("vehicle")
        open_visit_group.setdefault(duplicate_key, []).append(item)
        if (item.get("billable_days") or 0) > 7:
            exceptions.append({
                "severity": "High",
                "title": f"{item.get('vehicle_number')} outside longer than 7 calendar days",
                "record_name": item.get("name"),
                "message": "Visit duration exceeds the normal operational threshold.",
            })
        if (item.get("estimated_cost") or 0) > 250000:
            exceptions.append({
                "severity": "Medium",
                "title": f"{item.get('vehicle_number')} has unusually high estimated cost",
                "record_name": item.get("name"),
                "message": "Check daily-rate or billable-day accuracy before approval.",
            })
        if not item.get("daily_rate"):
            exceptions.append({
                "severity": "Medium",
                "title": f"{item.get('vehicle_number')} is missing the daily rate",
                "record_name": item.get("name"),
                "message": "Rate is required to calculate cost accurately.",
            })

    for vehicle, records in open_visit_group.items():
        if len(records) > 1:
            for record in records:
                exceptions.append({
                    "severity": "High",
                    "title": f"Duplicate open visits detected for {record.get('vehicle_number')}",
                    "record_name": record.get("name"),
                    "message": "Multiple open records exist for the same vehicle.",
                })

    available_hubs = sorted(set(hub_names))
    available_vehicle_types = frappe.get_all(
        "Vehicle Master",
        filters={"active": 1},
        fields=["vehicle_type"],
        distinct=True,
    )
    vehicle_types = sorted({record.get("vehicle_type") for record in available_vehicle_types if record.get("vehicle_type")})

    day_labels = [row["date"] for row in movement_rows]
    out_series = [row["out_count"] for row in movement_rows]
    in_series = [row["in_count"] for row in movement_rows]

    cost_trend = []
    for row in movement_rows:
        date_key = row["date"]
        date_value = date_key
        date_cost = sum(
            _safe_float(visit.get("final_cost") or visit.get("estimated_cost") or 0)
            for visit in completed_visits
            if (visit.get("in_time") or visit.get("out_time")) and getdate(visit.get("in_time") or visit.get("out_time")).strftime("%Y-%m-%d") == date_value
        )
        cost_trend.append({"date": date_key, "cost": date_cost})

    def _format_dashboard_payload():
        return {
            "summary": {
                "total_fleet": active_fleet_count,
                "vehicles_out": vehicles_out,
                "vehicles_inside": vehicles_inside,
                "estimated_current_exposure": total_open_exposure,
                "today_out": today_out,
                "today_in": today_in,
                "completed_visit_cost": completed_cost,
            },
            "open_visits": enriched_open_visits,
            "hub_summary": hub_summary,
            "exceptions": exceptions,
            "movement_trend": {"labels": day_labels, "out": out_series, "in": in_series},
            "cost_trend": {"labels": [item["date"] for item in cost_trend], "cost": [item["cost"] for item in cost_trend]},
            "available_hubs": available_hubs,
            "available_vehicle_types": vehicle_types,
            "generated_at": now_datetime().strftime("%Y-%m-%d %H:%M:%S"),
            "selected_hub": hub_name,
            "selected_period": {"from_date": selected_from_date.strftime("%Y-%m-%d"), "to_date": selected_to_date.strftime("%Y-%m-%d")},
        }

    return _format_dashboard_payload()
