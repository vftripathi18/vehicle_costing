
# Copyright (c) 2026, Vone8 Infotech and contributors

import secrets

import frappe
from frappe.model.document import Document


class VehicleMaster(Document):
    def before_insert(self):
        if not self.qr_token:
            self.qr_token = secrets.token_urlsafe(24)

    def validate(self):
        if not self.vehicle_number:
            frappe.throw("Vehicle Number is required.")

        if self.daily_rate is None or self.daily_rate < 0:
            frappe.throw("Daily Rate cannot be negative.")

        if not self.qr_token:
            self.qr_token = secrets.token_urlsafe(24)
