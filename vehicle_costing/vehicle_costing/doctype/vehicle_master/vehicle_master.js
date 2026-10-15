
frappe.ui.form.on("Vehicle Master", {
    refresh(frm) {
        if (frm.is_new() || !frm.doc.qr_token) return;

        frm.add_custom_button("Print Vehicle QR", async () => {
            const vehicleNumber = frm.doc.vehicle_number || frm.doc.name;
            const qrToken = frm.doc.qr_token;

            const win = window.open("", "_blank", "width=500,height=650");

            if (!win) {
                frappe.msgprint("Please allow pop-ups to print the vehicle QR.");
                return;
            }

            win.document.open();
            win.document.write(`
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1">
                    <title>Vehicle QR - ${frappe.utils.escape_html(vehicleNumber)}</title>
                    <style>
                        * { box-sizing: border-box; }
                        body {
                            font-family: Arial, sans-serif;
                            text-align: center;
                            padding: 28px;
                            color: #172033;
                        }
                        .sticker {
                            max-width: 360px;
                            margin: 0 auto;
                            padding: 24px;
                            border: 1px solid #dbe2ea;
                            border-radius: 14px;
                        }
                        h2 { margin: 0 0 8px; font-size: 23px; }
                        .vehicle { font-size: 18px; font-weight: 600; }
                        #qrcode {
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            margin: 24px auto;
                            min-height: 240px;
                        }
                        #qrcode img, #qrcode canvas {
                            max-width: 100%;
                            height: auto;
                        }
                        .message { color: #64748b; font-size: 13px; }
                        button {
                            margin-top: 20px;
                            padding: 10px 20px;
                            background: #1d4ed8;
                            color: white;
                            border: 0;
                            border-radius: 7px;
                            cursor: pointer;
                        }
                        @media print {
                            button { display: none; }
                            body { padding: 0; }
                            .sticker { border: none; }
                        }
                    </style>
                </head>
                <body>
                    <div class="sticker">
                        <h2>Vehicle QR Code</h2>
                        <p class="vehicle">${frappe.utils.escape_html(vehicleNumber)}</p>
                        <div id="qrcode">Generating QR code...</div>
                        <p class="message">Scan to record vehicle movement </p>
                        <br>
                        <p class="message">Wercatalyst Ventures Pvt Ltd</p>
                        <button onclick="window.print()">Print QR Sticker</button>
                    </div>

                    <script>
                        window.onload = function () {
                            const token = ${JSON.stringify(qrToken)};
                            const container = document.getElementById("qrcode");

                            const script = document.createElement("script");
                            script.src =
                                "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js";

                            script.onload = function () {
                                container.innerHTML = "";

                                new QRCode(container, {
                                    text: token,
                                    width: 240,
                                    height: 240,
                                    correctLevel: QRCode.CorrectLevel.M
                                });
                            };

                            script.onerror = function () {
                                container.textContent =
                                    "Unable to load QR library. Check your internet connection.";
                            };

                            document.head.appendChild(script);
                        };
                    </script>
                </body>
                </html>
            `);
            win.document.close();
        });
    }
});
