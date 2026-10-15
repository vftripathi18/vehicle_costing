(function () {
  if (window.__vehicle_cost_dashboard_loaded) return;
  window.__vehicle_cost_dashboard_loaded = true;

  function formatCurrency(value) {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 2,
    }).format(Number(value || 0));
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("en-IN").format(Number(value || 0));
  }

  function formatDateTime(value) {
    if (!value) return "—";
    try {
      const date = new Date(value);
      return date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
    } catch (error) {
      return value;
    }
  }

  function formatDays(value) {
    const numeric = Number(value || 0);
    return `${numeric.toFixed(0)} days`;
  }

  function loadCss() {
    const id = "vehicle-cost-dashboard-css";
    if (document.getElementById(id)) return Promise.resolve();

    return new Promise((resolve) => {
      const link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      link.href = "/assets/vehicle_costing/css/vehicle-dashboard.css";
      link.onload = resolve;
      document.head.appendChild(link);
    });
  }

  function loadChartJs() {
    if (window.Chart) return Promise.resolve();

    return new Promise((resolve, reject) => {
      const id = "vehicle-cost-dashboard-chartjs";
      if (document.getElementById(id)) {
        resolve();
        return;
      }

      const script = document.createElement("script");
      script.id = id;
      script.src = "https://cdn.jsdelivr.net/npm/chart.js";
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error("Chart.js failed to load."));
      document.head.appendChild(script);
    });
  }

  function withDashboardRoot(fn) {
    const root = document.getElementById("vehicle-cost-dashboard");
    if (!root) return;
    fn(root);
  }

  function renderEmptyState(container, title, message) {
    container.innerHTML = `
      <div class="vc-empty-state">
        <h4>${title}</h4>
        <div>${message}</div>
      </div>
    `;
  }

  function createKpiCard(config) {
    const tone = config.tone || "default";
    const classes = tone === "warning" ? "vc-kpi-note warning" : tone === "alert" ? "vc-kpi-note alert" : "vc-kpi-note";
    return `
      <article class="vc-kpi-card">
        <div class="vc-kpi-head">
          <div class="vc-kpi-icon">${config.icon}</div>
          <div class="vc-kpi-note ${tone === "warning" ? "warning" : tone === "alert" ? "alert" : ""}">
            <span class="pill">${config.badge || "Live"}</span>
          </div>
        </div>
        <h3 class="vc-kpi-value">${config.value}</h3>
        <div class="vc-kpi-label">
          <span>${config.label}</span>
          <span>${config.meta || ""}</span>
        </div>
      </article>
    `;
  }

  function createSummaryList(items) {
    if (!items || !items.length) {
      return `<div class="vc-empty-state"><h4>No hub insight</h4><div>No hub performance records available for the selected filters.</div></div>`;
    }

    return `
      <ul class="vc-summary-list">
        ${items.map((item) => `
          <li class="vc-summary-item">
            <div class="vc-summary-label">
              <strong>${item.hub_name || "Unknown hub"}</strong>
              <span>${formatNumber(item.vehicles_out || 0)} vehicles out</span>
            </div>
            <div class="vc-summary-value">${formatCurrency(item.current_exposure || 0)}</div>
          </li>
        `).join("")}
      </ul>
    `;
  }

  function renderTable(data) {
    const { open_visits = [], summary = {} } = data;
    const tableContainer = document.getElementById("vc-open-table-body");
    const totalContainer = document.getElementById("vc-open-total");
    const searchInput = document.getElementById("vc-table-search");
    const sortLabel = document.getElementById("vc-sort-label");

    const query = (searchInput && searchInput.value || "").trim().toLowerCase();
    let rows = [...open_visits];

    if (query) {
      rows = rows.filter((row) => {
        const haystack = `${row.vehicle_number || ""} ${row.hub_name || ""} ${row.vehicle_type || ""}`.toLowerCase();
        return haystack.includes(query);
      });
    }

    if (data.sortKey) {
      rows.sort((a, b) => {
        const dir = data.sortOrder === "asc" ? 1 : -1;
        const aValue = a[data.sortKey];
        const bValue = b[data.sortKey];

        if (data.sortKey === "out_time") {
          return (new Date(aValue || 0) - new Date(bValue || 0)) * (dir === 1 ? 1 : -1);
        }

        return ((Number(aValue) || 0) - (Number(bValue) || 0)) * dir;
      });
    }

    const pageSize = 10;
    const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
    const page = Math.min(Number(data.page || 1), totalPages);
    const start = (page - 1) * pageSize;
    const pageRows = rows.slice(start, start + pageSize);

    if (!pageRows.length) {
      tableContainer.innerHTML = `
        <tr>
          <td colspan="9">
            <div class="vc-empty-state">
              <h4>No vehicles outside</h4>
              <div>There are no matching open visits for the applied filters.</div>
            </div>
          </td>
        </tr>
      `;
      totalContainer.innerHTML = `
        <span class="vc-total-label">Filtered open exposure</span>
        <span class="vc-total-value">${formatCurrency(0)}</span>
      `;
      return;
    }

    tableContainer.innerHTML = pageRows.map((row) => `
      <tr>
        <td><a href="/app/vehicle-visit-log/${row.name}" target="_blank" style="color: var(--vc-blue); text-decoration: none; font-weight: 600;">${row.vehicle_number || row.vehicle || "—"}</a></td>
        <td>${row.vehicle_type || "—"}</td>
        <td>${row.hub_name || "—"}</td>
        <td>${formatDateTime(row.out_time)}</td>
        <td>${formatDays(Math.max((new Date() - new Date(row.out_time || 0)) / (1000 * 60 * 60 * 24), 0))}</td>
        <td>${Number(row.billable_days || 0)}</td>
        <td>${formatCurrency(row.daily_rate || 0)}</td>
        <td>${formatCurrency(row.estimated_cost || 0)}</td>
        <td><span class="vc-status-badge ${row.status === "Open" ? "vc-status-open" : row.status === "Completed" ? "vc-status-completed" : "vc-status-warning"}">${row.status || "Open"}</span></td>
      </tr>
    `).join("");

    const totalFilteredExposure = rows.reduce((sum, row) => sum + Number(row.estimated_cost || 0), 0);
    totalContainer.innerHTML = `
      <span class="vc-total-label">Filtered open exposure</span>
      <span class="vc-total-value">${formatCurrency(totalFilteredExposure)}</span>
    `;

    const pagination = document.getElementById("vc-pagination");
    if (pagination) {
      pagination.innerHTML = `
        <button class="vc-btn vc-btn-secondary" data-page="prev" ${page === 1 ? "disabled" : ""}>Previous</button>
        <span>${page} / ${totalPages}</span>
        <button class="vc-btn vc-btn-secondary" data-page="next" ${page >= totalPages ? "disabled" : ""}>Next</button>
      `;
    }

    if (sortLabel) {
      sortLabel.textContent = `Showing ${pageRows.length} of ${rows.length} open entries`;
    }

    const resetButton = document.getElementById("vc-reset-filters");
    if (resetButton) {
      resetButton.disabled = false;
    }
  }

  function renderDashboard(root, data) {
    const dashboard = root;
    const summary = data.summary || {};
    const todayOut = Number(summary.today_out || 0);
    const todayIn = Number(summary.today_in || 0);
    const moveDelta = todayOut - todayIn;

    dashboard.innerHTML = `
      <div class="vc-header">
        <div class="vc-topbar">
          <div class="vc-title-wrap">
            <span class="vc-kicker">Operations intelligence</span>
            <h2>Vehicle Cost Intelligence</h2>
            <p class="vc-subtitle">Executive Fleet Operations &amp; Cost Overview</p>
          </div>
          <div class="vc-action-buttons">
            <button class="vc-btn vc-btn-primary" id="vc-refresh-btn">Refresh</button>
          </div>
        </div>

        <div class="vc-header-meta">
          <div class="vc-header-pill"><span class="dot"></span> <span id="vc-current-time">${new Date().toLocaleString("en-IN")}</span></div>
          <div class="vc-header-pill">Last refresh: <strong id="vc-last-refresh">${data.generated_at || "—"}</strong></div>
        </div>

        <div class="vc-filter-row">
          <div class="vc-filter-group">
            <div class="vc-field">
              <label>Hub</label>
              <select id="vc-hub-filter">
                <option value="">All hubs</option>
                ${(data.available_hubs || []).map((hub) => `<option value="${hub}" ${hub === data.selected_hub ? "selected" : ""}>${hub}</option>`).join("")}
              </select>
            </div>
            <div class="vc-field">
              <label>From</label>
              <input type="date" id="vc-date-from" value="${data.selected_period?.from_date || ""}">
            </div>
            <div class="vc-field">
              <label>To</label>
              <input type="date" id="vc-date-to" value="${data.selected_period?.to_date || ""}">
            </div>
            <div class="vc-field">
              <label>Vehicle type</label>
              <select id="vc-vehicle-type-filter">
                <option value="">All types</option>
                ${(data.available_vehicle_types || []).map((type) => `<option value="${type}">${type}</option>`).join("")}
              </select>
            </div>
          </div>

          <div class="vc-action-buttons">
            <button class="vc-btn vc-btn-secondary" id="vc-reset-filters">Reset filters</button>
          </div>
        </div>
      </div>

      <section class="vc-kpi-grid">
        ${createKpiCard({ icon: "🚚", value: formatNumber(summary.total_fleet || 0), label: "Total Fleet", meta: "Active vehicles", badge: "Live" })}
        ${createKpiCard({ icon: "📦", value: formatNumber(summary.vehicles_out || 0), label: "Vehicles Outside", meta: "Awaiting return", badge: "Open" })}
        ${createKpiCard({ icon: "🏠", value: formatNumber(summary.vehicles_inside || 0), label: "Vehicles Inside", meta: "On-site", badge: "Live" })}
        ${createKpiCard({ icon: "₹", value: formatCurrency(summary.estimated_current_exposure || 0), label: "Estimated Current Exposure", meta: "Open visits", badge: "Live" })}
        ${createKpiCard({ icon: "🔄", value: `${formatNumber(todayOut)} / ${formatNumber(todayIn)}`, label: "Today's Vehicle Movements", meta: `${moveDelta >= 0 ? "+" : ""}${formatNumber(moveDelta)} delta`, badge: "Today", tone: moveDelta < 0 ? "warning" : "default" })}
        ${createKpiCard({ icon: "💰", value: formatCurrency(summary.completed_visit_cost || 0), label: "Completed Visit Cost", meta: "Selected period", badge: "Closed" })}
      </section>

      <div class="vc-grid-two">
        <section class="vc-card">
          <div class="vc-card-header">
            <h3 class="vc-card-title">Fleet Status Distribution</h3>
            <span class="vc-card-subtitle">Current split</span>
          </div>
          <div class="vc-chart-wrap">
            <canvas id="vc-fleet-chart"></canvas>
          </div>
        </section>

        <section class="vc-card">
          <div class="vc-card-header">
            <h3 class="vc-card-title">Hub-Wise Cost Analysis</h3>
            <span class="vc-card-subtitle">Current exposure vs completed cost</span>
          </div>
          <div class="vc-chart-wrap">
            <canvas id="vc-hub-chart"></canvas>
          </div>
        </section>
      </div>

      <div class="vc-grid-two">
        <section class="vc-card">
          <div class="vc-card-header">
            <h3 class="vc-card-title">Vehicle Cost Trend</h3>
            <span class="vc-card-subtitle">Completed visit cost by day</span>
          </div>
          <div class="vc-chart-wrap">
            <canvas id="vc-cost-chart"></canvas>
          </div>
        </section>

        <section class="vc-card">
          <div class="vc-card-header">
            <h3 class="vc-card-title">Vehicle Movement Trend</h3>
            <span class="vc-card-subtitle">Daily OUT and IN movements</span>
          </div>
          <div class="vc-chart-wrap">
            <canvas id="vc-movement-chart"></canvas>
          </div>
        </section>
      </div>

      <section class="vc-card vc-table-card">
        <div class="vc-toolbar">
          <div>
            <h3 class="vc-card-title">Live Open Vehicle Cost Table</h3>
            <div class="vc-card-subtitle" id="vc-sort-label">Open visit records</div>
          </div>
          <input id="vc-table-search" class="vc-table-search" placeholder="Search vehicle number" />
        </div>
        <div class="vc-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Vehicle Number</th>
                <th>Vehicle Type</th>
                <th>Hub</th>
                <th data-sort="out_time">OUT Date &amp; Time</th>
                <th>Elapsed Time</th>
                <th data-sort="billable_days">Billable Days</th>
                <th data-sort="daily_rate">Daily Rate</th>
                <th data-sort="estimated_cost">Estimated Cost</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody id="vc-open-table-body"></tbody>
          </table>
        </div>
        <div class="vc-table-total" id="vc-open-total"></div>
        <div class="vc-table-total" style="justify-content: center; border-top: 1px solid rgba(15, 23, 42, 0.06); padding-top: 14px;">
          <div id="vc-pagination"></div>
        </div>
      </section>

      <div class="vc-grid-two" style="margin-top: 22px;">
        <section class="vc-card">
          <div class="vc-card-header">
            <h3 class="vc-card-title">Hub Performance</h3>
            <span class="vc-card-subtitle">Current operating view</span>
          </div>
          ${createSummaryList(data.hub_summary || [])}
        </section>

        <section class="vc-card">
          <div class="vc-card-header">
            <h3 class="vc-card-title">Exception &amp; Attention Panel</h3>
            <span class="vc-card-subtitle">Action required</span>
          </div>
          <div class="vc-summary-list">
            ${(data.exceptions || []).length ? data.exceptions.slice(0, 6).map((item) => `
              <div class="vc-summary-item">
                <div class="vc-summary-label">
                  <strong>${item.title}</strong>
                  <span>${item.message}</span>
                </div>
                <div class="vc-status-badge ${item.severity === "High" ? "vc-status-warning" : "vc-status-open"}">${item.severity}</div>
              </div>
            `).join("") : `<div class="vc-empty-state"><h4>All clear</h4><div>No exceptions or operational risks are currently flagged.</div></div>`}
          </div>
        </section>
      </div>
    `;

    const graphState = {
      page: 1,
      sortKey: "out_time",
      sortOrder: "desc",
    };

    const tableSearch = document.getElementById("vc-table-search");
    tableSearch.addEventListener("input", (event) => {
      graphState.search = event.target.value;
      renderTable({ ...data, ...graphState });
    });

    const sortButtons = document.querySelectorAll("[data-sort]");
    sortButtons.forEach((button) => {
      button.onclick = () => {
        const key = button.getAttribute("data-sort");
        if (graphState.sortKey === key) {
          graphState.sortOrder = graphState.sortOrder === "asc" ? "desc" : "asc";
        } else {
          graphState.sortKey = key;
          graphState.sortOrder = "desc";
        }
        renderTable({ ...data, ...graphState });
      };
    });

    document.getElementById("vc-refresh-btn").addEventListener("click", () => {
      fetchDashboard();
    });

    document.getElementById("vc-reset-filters").addEventListener("click", () => {
      const hubFilter = document.getElementById("vc-hub-filter");
      const dateFrom = document.getElementById("vc-date-from");
      const dateTo = document.getElementById("vc-date-to");
      const typeFilter = document.getElementById("vc-vehicle-type-filter");

      if (hubFilter) hubFilter.value = "";
      if (dateFrom) dateFrom.value = data.selected_period?.from_date || "";
      if (dateTo) dateTo.value = data.selected_period?.to_date || "";
      if (typeFilter) typeFilter.value = "";
      fetchDashboard();
    });

    const hubFilter = document.getElementById("vc-hub-filter");
    const dateFrom = document.getElementById("vc-date-from");
    const dateTo = document.getElementById("vc-date-to");
    const typeFilter = document.getElementById("vc-vehicle-type-filter");

    [hubFilter, dateFrom, dateTo, typeFilter].forEach((element) => {
      if (!element) return;
      element.onchange = () => fetchDashboard();
    });

    document.getElementById("vc-pagination").addEventListener("click", (event) => {
      const target = event.target.closest("button[data-page]");
      if (!target) return;
      const direction = target.getAttribute("data-page");
      const total = Math.max(1, Math.ceil((data.open_visits || []).length / 10));
      if (direction === "prev") graphState.page = Math.max(1, graphState.page - 1);
      if (direction === "next") graphState.page = Math.min(total, graphState.page + 1);
      renderTable({ ...data, ...graphState });
    });

    renderTable({ ...data, ...graphState });

    const fleetCtx = document.getElementById("vc-fleet-chart");
    if (fleetCtx && window.Chart) {
      new Chart(fleetCtx, {
        type: "doughnut",
        data: {
          labels: ["Inside vehicles", "Outside vehicles"],
          datasets: [{
            data: [summary.vehicles_inside || 0, summary.vehicles_out || 0],
            backgroundColor: ["#2d6cdf", "#cfe0ff"],
            borderWidth: 0,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: "bottom" } },
        },
      });
    }

    const hubCtx = document.getElementById("vc-hub-chart");
    if (hubCtx && window.Chart) {
      const labels = (data.hub_summary || []).map((item) => item.hub_name || "Hub");
      const exposure = (data.hub_summary || []).map((item) => Number(item.current_exposure || 0));
      const completed = (data.hub_summary || []).map((item) => Number(item.completed_visit_cost || 0));
      new Chart(hubCtx, {
        type: "bar",
        data: {
          labels,
          datasets: [
            { label: "Current exposure", data: exposure, backgroundColor: "#2d6cdf", borderRadius: 8 },
            { label: "Completed cost", data: completed, backgroundColor: "#bfd4ff", borderRadius: 8 },
          ],
        },
        options: {
          indexAxis: "y",
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: "bottom" } },
          scales: {
            x: { ticks: { callback: (value) => formatCurrency(value) } },
          },
        },
      });
    }

    const costCtx = document.getElementById("vc-cost-chart");
    if (costCtx && window.Chart) {
      const labels = (data.cost_trend && data.cost_trend.labels) || [];
      const values = (data.cost_trend && data.cost_trend.cost) || [];
      new Chart(costCtx, {
        type: "line",
        data: {
          labels,
          datasets: [{
            label: "Completed cost",
            data: values,
            borderColor: "#2d6cdf",
            backgroundColor: "rgba(45,108,223,0.14)",
            tension: 0.35,
            fill: true,
            borderWidth: 2,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            y: { ticks: { callback: (value) => formatCurrency(value) } },
          },
        },
      });
    }

    const movementCtx = document.getElementById("vc-movement-chart");
    if (movementCtx && window.Chart) {
      const labels = (data.movement_trend && data.movement_trend.labels) || [];
      const outSeries = (data.movement_trend && data.movement_trend.out) || [];
      const inSeries = (data.movement_trend && data.movement_trend.in) || [];
      new Chart(movementCtx, {
        type: "line",
        data: {
          labels,
          datasets: [
            { label: "OUT", data: outSeries, borderColor: "#2d6cdf", backgroundColor: "rgba(45,108,223,0.12)", tension: 0.35 },
            { label: "IN", data: inSeries, borderColor: "#0f8a5f", backgroundColor: "rgba(15,138,95,0.12)", tension: 0.35 },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: "bottom" } },
        },
      });
    }
  }

  async function fetchDashboard() {
    const root = document.getElementById("vehicle-cost-dashboard");
    if (!root) return;

    const hubFilter = document.getElementById("vc-hub-filter");
    const fromFilter = document.getElementById("vc-date-from");
    const toFilter = document.getElementById("vc-date-to");
    const typeFilter = document.getElementById("vc-vehicle-type-filter");

    const args = {};
    if (hubFilter && hubFilter.value) args.hub_name = hubFilter.value;
    if (fromFilter && fromFilter.value) args.from_date = fromFilter.value;
    if (toFilter && toFilter.value) args.to_date = toFilter.value;
    if (typeFilter && typeFilter.value) args.vehicle_type = typeFilter.value;

    try {
      const response = await frappe.call({
        method: "vehicle_costing.api.get_vehicle_dashboard_data",
        args,
      });

      if (!response.message) {
        renderEmptyState(root, "Dashboard unavailable", "The vehicle dashboard could not load data for the current filters.");
        return;
      }

      renderDashboard(root, response.message);

      const currentTime = document.getElementById("vc-current-time");
      if (currentTime) {
        setInterval(() => {
          currentTime.textContent = new Date().toLocaleString("en-IN");
        }, 1000);
      }
    } catch (error) {
      renderEmptyState(root, "Access denied", error.message || "Unable to load the dashboard data.");
    }
  }

  function initDashboard() {
    withDashboardRoot(async (root) => {
      try {
        await loadCss();
        await loadChartJs();
        fetchDashboard();
      } catch (error) {
        root.innerHTML = `<div class="vc-empty-state"><h4>Dashboard unavailable</h4><div>${error.message || "Unable to initialise the dashboard."}</div></div>`;
      }
    });
  }

  if (window.frappe && frappe.ready) {
    frappe.ready(initDashboard);
  } else {
    document.addEventListener("DOMContentLoaded", initDashboard);
  }
})();
