const express = require("express");

const app = express();

const PORT = process.env.PORT || 3000;


/*
=========================================================
CORS
Allows the Numora website to communicate with Render.
=========================================================
*/

app.use((req, res, next) => {

    res.header(
        "Access-Control-Allow-Origin",
        "*"
    );

    res.header(
        "Access-Control-Allow-Methods",
        "GET,POST,OPTIONS"
    );

    res.header(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization"
    );

    if (req.method === "OPTIONS") {

        return res.sendStatus(204);

    }

    next();

});


app.use(express.json());


/*
=========================================================
PAYSTACK SECRET KEY
=========================================================
*/

const getPaystackSecretKey = () => {

    return process.env.PAYSTACK_SECRET_KEY;

};


/*
=========================================================
HEALTH CHECK
=========================================================
*/

app.get("/", (req, res) => {

    res.status(200).json({

        success: true,

        service:
            "Numora Backend",

        status:
            "online"

    });

});


/*
=========================================================
CREATE PAYSTACK BANK TRANSFER
=========================================================
*/

app.post(
    "/api/paystack/bank-transfer",
    async (req, res) => {

        try {

            const {
                email,
                amount,
                reference
            } = req.body;


            const secretKey =
                getPaystackSecretKey();


            if (!secretKey) {

                return res.status(500).json({

                    success: false,

                    message:
                        "Paystack secret key is not configured."

                });

            }


            /*
            -------------------------------------------------
            VALIDATE REQUEST
            -------------------------------------------------
            */

            if (!email) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Customer email is required."

                });

            }


            if (
                !amount ||
                Number(amount) <= 0
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "A valid payment amount is required."

                });

            }


            if (!reference) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Payment reference is required."

                });

            }


            /*
            -------------------------------------------------
            CONVERT NAIRA TO KOBO
            -------------------------------------------------
            */

            const amountInKobo =
                Math.round(
                    Number(amount) * 100
                );


            /*
            -------------------------------------------------
            CREATE PAYSTACK CHARGE
            -------------------------------------------------
            */

            const paystackResponse =
                await fetch(
                    "https://api.paystack.co/charge",
                    {

                        method:
                            "POST",

                        headers: {

                            "Authorization":
                                `Bearer ${secretKey}`,

                            "Content-Type":
                                "application/json"

                        },

                        body:
                            JSON.stringify({

                                email:
                                    email,

                                amount:
                                    amountInKobo,

                                currency:
                                    "NGN",

                                reference:
                                    reference,

                                bank_transfer: {

                                    account_expires_at:
                                        new Date(
                                            Date.now() +
                                            60 * 60 * 1000
                                        ).toISOString()

                                }

                            })

                    }
                );


            const data =
                await paystackResponse.json();


            /*
            -------------------------------------------------
            PAYSTACK ERROR
            -------------------------------------------------
            */

            if (!paystackResponse.ok) {

                console.error(
                    "Paystack error:",
                    data
                );


                return res.status(
                    paystackResponse.status
                ).json({

                    success: false,

                    message:
                        data.message ||
                        "Paystack payment creation failed."

                });

            }


            /*
            -------------------------------------------------
            SUCCESS
            -------------------------------------------------
            */

            return res.status(200).json({

                success: true,

                message:
                    "Bank transfer payment created.",

                data:
                    data.data

            });

        }


        catch (error) {

            console.error(
                "Bank transfer error:",
                error
            );


            return res.status(500).json({

                success: false,

                message:
                    "Unable to create bank transfer payment."

            });

        }

    }
);


/*
=========================================================
VERIFY PAYMENT
=========================================================

Used when the customer taps:

"I Have Paid"

The secret Paystack key stays on the Render server.
=========================================================
*/

app.post(
    "/api/paystack/verify",
    async (req, res) => {

        try {

            const {
                reference
            } = req.body;


            const secretKey =
                getPaystackSecretKey();


            if (!secretKey) {

                return res.status(500).json({

                    success: false,

                    message:
                        "Paystack secret key is not configured."

                });

            }


            /*
            -------------------------------------------------
            VALIDATE REFERENCE
            -------------------------------------------------
            */

            if (!reference) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Payment reference is required."

                });

            }


            /*
            -------------------------------------------------
            ASK PAYSTACK FOR TRANSACTION STATUS
            -------------------------------------------------
            */

            const paystackResponse =
                await fetch(
                    "https://api.paystack.co/transaction/verify/" +
                    encodeURIComponent(reference),
                    {

                        method:
                            "GET",

                        headers: {

                            "Authorization":
                                `Bearer ${secretKey}`,

                            "Content-Type":
                                "application/json"

                        }

                    }
                );


            const data =
                await paystackResponse.json();


            /*
            -------------------------------------------------
            PAYSTACK ERROR
            -------------------------------------------------
            */

            if (!paystackResponse.ok) {

                console.error(
                    "Paystack verification error:",
                    data
                );


                return res.status(
                    paystackResponse.status
                ).json({

                    success: false,

                    message:
                        data.message ||
                        "Unable to verify payment."

                });

            }


            /*
            -------------------------------------------------
            TRANSACTION RESULT
            -------------------------------------------------
            */

            const transaction =
                data.data || {};

            const status =
                transaction.status || "unknown";


            /*
            -------------------------------------------------
            DO NOT CALL A PAYMENT SUCCESSFUL JUST BECAUSE
            THE VERIFY API REQUEST ITSELF SUCCEEDED.
            -------------------------------------------------
            */

            if (status === "success") {

                return res.status(200).json({

                    success: true,

                    paid: true,

                    status:
                        status,

                    reference:
                        transaction.reference,

                    amount:
                        transaction.amount,

                    currency:
                        transaction.currency,

                    paidAt:
                        transaction.paid_at || null

                });

            }


            /*
            -------------------------------------------------
            PAYMENT NOT SUCCESSFUL YET
            -------------------------------------------------
            */

            return res.status(200).json({

                success: true,

                paid: false,

                status:
                    status,

                reference:
                    transaction.reference ||
                    reference,

                message:
                    "Payment has not been confirmed yet."

            });

        }


        catch (error) {

            console.error(
                "Payment verification error:",
                error
            );


            return res.status(500).json({

                success: false,

                message:
                    "Unable to verify payment."

            });

        }

    }
);


/*
=========================================================
PAYSTACK WEBHOOK
=========================================================

Paystack sends successful payment events here.

IMPORTANT:
This endpoint is only the starting point for the
automatic fulfillment system.

We will connect Firestore/order activation after
verification is tested.
=========================================================
*/

app.post(
    "/api/paystack/webhook",
    (req, res) => {

        try {

            const crypto =
                require("crypto");


            const secretKey =
                getPaystackSecretKey();


            if (!secretKey) {

                console.error(
                    "Webhook rejected: Paystack secret key missing."
                );

                return res.sendStatus(200);

            }


            const signature =
                req.headers[
                    "x-paystack-signature"
                ];


            if (!signature) {

                console.warn(
                    "Webhook received without Paystack signature."
                );

                return res.sendStatus(200);

            }


            /*
            -------------------------------------------------
            RECREATE PAYSTACK SIGNATURE
            -------------------------------------------------
            */

            const rawBody =
                JSON.stringify(req.body);


            const expectedSignature =
                crypto
                    .createHmac(
                        "sha512",
                        secretKey
                    )
                    .update(rawBody)
                    .digest("hex");


            /*
            -------------------------------------------------
            SECURITY CHECK
            -------------------------------------------------
            */

            if (
                signature !==
                expectedSignature
            ) {

                console.warn(
                    "Invalid Paystack webhook signature."
                );

                return res.sendStatus(200);

            }


            const event =
                req.body;


            console.log(
                "Paystack webhook received:",
                event.event
            );


            /*
            -------------------------------------------------
            SUCCESSFUL PAYMENT
            -------------------------------------------------
            */

            if (
                event.event ===
                "charge.success"
            ) {

                const payment =
                    event.data || {};


                console.log(
                    "PAYMENT SUCCESS:",
                    {

                        reference:
                            payment.reference,

                        amount:
                            payment.amount,

                        currency:
                            payment.currency,

                        channel:
                            payment.channel,

                        paidAt:
                            payment.paid_at

                    }
                );


                /*
                -------------------------------------------------
                FIRESTORE ORDER UPDATE WILL BE CONNECTED HERE.
                -------------------------------------------------

                After we connect Firebase Admin:

                order.paymentStatus
                    = "Paid"

                order.status
                    = "Activating"

                Then the number activation process runs.
                -------------------------------------------------
                */

            }


            /*
            -------------------------------------------------
            ACKNOWLEDGE PAYSTACK
            -------------------------------------------------
            */

            return res.sendStatus(200);

        }


        catch (error) {

            console.error(
                "Webhook error:",
                error
            );

            /*
            Always acknowledge the webhook for now.
            */

            return res.sendStatus(200);

        }

    }
);


/*
=========================================================
START SERVER
=========================================================
*/

app.listen(
    PORT,
    () => {

        console.log(
            `Numora backend running on port ${PORT}`
        );

    }
);