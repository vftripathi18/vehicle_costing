### Vehicle Costing

QR-based vehicle IN/OUT tracking and daily costing

### Installation

You can install this app using the [bench](https://github.com/frappe/bench) CLI:

```bash
cd $PATH_TO_YOUR_BENCH
bench get-app $URL_OF_THIS_REPO --branch develop
bench install-app vehicle_costing
```

### Dashboard Usage

Use the dashboard inside an existing Frappe Custom HTML block by adding the CSS and JS assets and creating a placeholder element:

```html
<div id="vehicle-cost-dashboard"></div>
<link rel="stylesheet" href="/assets/vehicle_costing/css/vehicle-dashboard.css" />
<script src="/assets/vehicle_costing/js/vehicle-dashboard.js"></script>
```

The script automatically loads the dashboard into the `#vehicle-cost-dashboard` container and reads live data from the `vehicle_costing.api.get_vehicle_dashboard_data` API, respecting the logged-in user and hub permissions.

### Contributing

This app uses `pre-commit` for code formatting and linting. Please [install pre-commit](https://pre-commit.com/#installation) and enable it for this repository:

```bash
cd apps/vehicle_costing
pre-commit install
```

Pre-commit is configured to use the following tools for checking and formatting your code:

- ruff
- eslint
- prettier
- pyupgrade

### License

mit
