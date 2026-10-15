frappe.ready(function () {
    // Prevent duplicate event-handler registration if this script loads twice.
    if (window.vehicleScannerInitialized) return;
    window.vehicleScannerInitialized = true;

    const startButton = document.getElementById("start-scan");
    const stopButton = document.getElementById("stop-scan");
    const resultBox = document.getElementById("scan-result");

    if (!startButton || !stopButton || !resultBox) {
        console.error("Vehicle scanner: required HTML elements are missing.");
        return;
    }

    let scanner = null;
    let processing = false;
    let lastSubmittedToken = null;
    let lastSubmittedAt = 0;

    const DUPLICATE_COOLDOWN_MS = 3000;

    function showResult(message, type = "info") {
        resultBox.className = `alert alert-${type}`;
        resultBox.textContent = message;
        resultBox.style.display = "block";
    }

    function updateButtons(scanning) {
        startButton.style.display = scanning ? "none" : "block";
        stopButton.style.display = scanning ? "block" : "none";
    }

    async function stopScanner() {
        const activeScanner = scanner;
        scanner = null;

        if (!activeScanner) return;

        try {
            await activeScanner.stop();
        } catch (error) {
            console.warn("Scanner stop:", error);
        }

        try {
            await activeScanner.clear();
        } catch (error) {
            console.warn("Scanner cleanup:", error);
        }
    }

    async function handleDecodedQR(decodedText) {
        const token = String(decodedText || "").trim();

        if (!token || processing) return;

        const now = Date.now();

        if (
            token === lastSubmittedToken &&
            now - lastSubmittedAt < DUPLICATE_COOLDOWN_MS
        ) {
            return;
        }

        // Set the lock synchronously before any asynchronous operation.
        processing = true;
        lastSubmittedToken = token;
        lastSubmittedAt = now;

        updateButtons(false);
        showResult("Processing vehicle scan...", "info");

        try {
            // Stop camera callbacks before sending the request.
            await stopScanner();

            const response = await frappe.call({
                method: "vehicle_costing.api.scan_vehicle",
                args: {
                    qr_token: token
                }
            });

            const data = response && response.message;

            if (!data) {
                throw new Error("The server returned an empty response.");
            }

            if (data.action === "DUPLICATE") {
                showResult(
                    data.message || "Duplicate scan ignored. No additional entry created.",
                    "warning"
                );
            } else {
                showResult(
                    `${data.message || "Scan recorded successfully."}` +
                    (data.vehicle ? ` Vehicle: ${data.vehicle}.` : "") +
                    (data.hub ? ` Hub: ${data.hub}.` : ""),
                    "success"
                );
            }
        } catch (error) {
            console.error("Vehicle scan request failed:", error);

            showResult(
                "The scan could not be confirmed. Check Vehicle Visit Log before retrying, because the server may already have saved the entry.",
                "danger"
            );
        } finally {
            processing = false;
            updateButtons(false);
        }
    }

    startButton.addEventListener("click", async function () {
        if (processing || scanner) return;

        if (typeof Html5Qrcode === "undefined") {
            showResult(
                "Scanner library failed to load. Check your internet connection.",
                "danger"
            );
            return;
        }

        processing = true;
        updateButtons(true);

        const newScanner = new Html5Qrcode("scanner");
        scanner = newScanner;

        try {
            await newScanner.start(
                { facingMode: "environment" },
                {
                    fps: 10,
                    qrbox: { width: 250, height: 250 }
                },
                async function (decodedText) {
                    // Keep processing locked until the request finishes.
                    if (scanner !== newScanner || !processing) return;

                    await handleDecodedQR(decodedText);
                },
                function () {
                    // Ignore normal frames where no QR code is detected.
                }
            );

            processing = false;
            showResult(
                "Camera ready. Scan the vehicle QR code once.",
                "info"
            );
        } catch (error) {
            console.error("Camera start failed:", error);

            if (scanner === newScanner) {
                scanner = null;
            }

            try {
                await newScanner.clear();
            } catch (_) {
                // Scanner may not have initialized completely.
            }

            processing = false;
            updateButtons(false);

            showResult(
                "Unable to access camera. Allow camera permission and use HTTPS or localhost.",
                "danger"
            );
        }
    });

    stopButton.addEventListener("click", async function () {
        if (processing) {
            showResult("A scan is being processed. Please wait.", "warning");
            return;
        }

        processing = true;
        updateButtons(false);

        await stopScanner();

        processing = false;

        showResult("Scanner stopped.", "info");
    });
});