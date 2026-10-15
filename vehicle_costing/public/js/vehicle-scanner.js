
frappe.ready(function () {
    const startButton = document.getElementById("start-scan");
    const stopButton = document.getElementById("stop-scan");
    const resultBox = document.getElementById("scan-result");

    let scanner = null;
    let processing = false;

    function showResult(message, type = "info") {
        resultBox.className = `alert alert-${type}`;
        resultBox.textContent = message;
        resultBox.style.display = "block";
    }

    startButton.addEventListener("click", async function () {
        if (scanner) return;

        if (typeof Html5Qrcode === "undefined") {
            showResult("Scanner library failed to load. Check your internet connection.", "danger");
            return;
        }

        scanner = new Html5Qrcode("scanner");
        startButton.style.display = "none";
        stopButton.style.display = "block";

        try {
            await scanner.start(
                { facingMode: "environment" },
                { fps: 10, qrbox: { width: 250, height: 250 } },
                async function (decodedText) {
                    if (processing) return;
                    processing = true;

                    try {
                        await scanner.stop();
                        scanner = null;
                        stopButton.style.display = "none";

                        const response = await frappe.call({
                            method: "vehicle_costing.api.scan_vehicle",
                            args: { qr_token: decodedText }
                        });

                        const data = response.message;
                        showResult(
                            `${data.message} Vehicle: ${data.vehicle}. Hub: ${data.hub}.`,
                            "success"
                        );
                    } catch (error) {
                        showResult(
                            error?.message || "Unable to record the scan. Please try again.",
                            "danger"
                        );
                    } finally {
                        processing = false;
                        startButton.style.display = "block";
                    }
                }
            );
        } catch (error) {
            scanner = null;
            startButton.style.display = "block";
            stopButton.style.display = "none";
            showResult("Unable to access camera. Allow camera permission and use HTTPS or localhost.", "danger");
        }
    });

    stopButton.addEventListener("click", async function () {
        if (scanner) {
            await scanner.stop();
            scanner = null;
        }
        startButton.style.display = "block";
        stopButton.style.display = "none";
    });
});
