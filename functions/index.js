const express = require("express");
const crypto = require("crypto");
const admin = require("firebase-admin");

const app = express();

const PORT = process.env.PORT || 3000;


/*
=========================================================
FIREBASE ADMIN
=========================================================
*/

let firebaseInitialized = false;

try {

    const serviceAccount =
        JSON.parse(
            process.env.FIREBASE_SERVICE_ACCOUNT_JSON
        );

    admin.initializeApp({
        credential:
            admin.credential.cert(
                serviceAccount
            )
    });

    firebaseInitialized = true;

    console.log(
        "Firebase Admin initialized."
    );

}
catch(error){

    console.error(
        "Firebase Admin initialization failed:",
        error.message
    );

}


/*
=========================================================
FIRESTORE
=========================================================
*/

const db =
    firebaseInitialized
        ? admin.firestore()
        : null;


/*
=========================================================
CORS
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

    if(
        req.method === "OPTIONS"
    ){

        return res.sendStatus(204);

    }

    next();

});


/*
=========================================================
RAW BODY + JSON

Paystack webhook signatures are calculated from
the original request body.

We keep the raw body available as req.rawBody.
=========================================================
*/

app.use(
    express.json({
        verify: (
            req,
            res,
            buffer
        ) => {

            req.rawBody =
                Buffer.from(buffer);

        }
    })
);


/*
=========================================================
PAYSTACK SECRET
=========================================================
*/

function getPaystackSecretKey(){

    return process.env.PAYSTACK_SECRET_KEY;

}


/*
=========================================================
HEALTH CHECK
=========================================================
*/

app.get(
    "/",
    (req, res) => {

        res.status(200).json({

            success: true,

            service:
                "Numora Backend",

            status:
                "online",

            firebase:
                firebaseInitialized
                    ? "connected"
                    : "not connected"

        });

    }
);


/*
=========================================================
CREATE BANK TRANSFER
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


            if(!secretKey){

                return res.status(500).json({

                    success: false,

                    message:
                        "Paystack secret key is not configured."

                });

            }


            if(!email){

                return res.status(400).json({

                    success: false,

                    message:
                        "Customer email is required."

                });

            }


            if(
                !amount ||
                Number(amount) <= 0
            ){

                return res.status(400).json({

                    success: false,

                    message:
                        "A valid payment amount is required."

                });

            }


            if(!reference){

                return res.status(400).json({

                    success: false,

                    message:
                        "Payment reference is required."

                });

            }


            const amountInKobo =
                Math.round(
                    Number(amount) * 100
                );


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


            if(!paystackResponse.ok){

                console.error(
                    "Paystack charge error:",
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


            return res.status(200).json({

                success: true,

                message:
                    "Bank transfer payment created.",

                data:
                    data.data

            });

        }


        catch(error){

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

Used by:

"I Have Paid"

We verify directly with Paystack.

IMPORTANT:
The frontend does NOT decide whether payment succeeded.
Paystack decides.
=========================================================
*/

app.post(
    "/api/paystack/verify",
    async (req, res) => {

        try {

            const {
                reference,
                expectedAmount
            } = req.body;


            const secretKey =
                getPaystackSecretKey();


            if(!secretKey){

                return res.status(500).json({

                    success: false,

                    message:
                        "Paystack secret key is not configured."

                });

            }


            if(!reference){

                return res.status(400).json({

                    success: false,

                    message:
                        "Payment reference is required."

                });

            }


            const response =
                await fetch(
                    "https://api.paystack.co/transaction/verify/" +
                    encodeURIComponent(
                        reference
                    ),
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


            const result =
                await response.json();


            if(!response.ok){

                console.error(
                    "Paystack verify error:",
                    result
                );


                return res.status(
                    response.status
                ).json({

                    success: false,

                    message:
                        result.message ||
                        "Unable to verify payment."

                });

            }


            const transaction =
                result.data || {};


            const status =
                transaction.status ||
                "unknown";


            const paidAmount =
                Number(
                    transaction.amount || 0
                );


            /*
            -------------------------------------------------
            EXPECTED AMOUNT

            Firestore stores price in Naira.
            Paystack returns amount in kobo.
            -------------------------------------------------
            */

            let amountMatches = true;


            if(
                expectedAmount !== undefined &&
                expectedAmount !== null
            ){

                const expectedKobo =
                    Math.round(
                        Number(
                            expectedAmount
                        ) * 100
                    );


                amountMatches =
                    paidAmount ===
                    expectedKobo;

            }


            /*
            -------------------------------------------------
            PAYMENT SUCCESS
            -------------------------------------------------
            */

            if(
                status === "success" &&
                amountMatches
            ){

                return res.status(200).json({

                    success: true,

                    paid: true,

                    status:
                        status,

                    reference:
                        transaction.reference,

                    amount:
                        paidAmount,

                    currency:
                        transaction.currency,

                    paidAt:
                        transaction.paid_at ||
                        null

                });

            }


            /*
            -------------------------------------------------
            WRONG AMOUNT
            -------------------------------------------------
            */

            if(
                status === "success" &&
                !amountMatches
            ){

                return res.status(200).json({

                    success: true,

                    paid: false,

                    status:
                        status,

                    amountMismatch:
                        true,

                    message:
                        "Payment was received, but the amount does not match the order."

                });

            }


            /*
            -------------------------------------------------
            PAYMENT STILL PENDING
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


        catch(error){

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

Paystack sends:

charge.success

when a payment succeeds.

This is what will eventually activate the customer's
number automatically.
=========================================================
*/

app.post(
    "/api/paystack/webhook",
    async (req, res) => {

        try {

            const secretKey =
                getPaystackSecretKey();


            if(!secretKey){

                console.error(
                    "Webhook: Paystack secret key missing."
                );

                return res.sendStatus(200);

            }


            const signature =
                req.headers[
                    "x-paystack-signature"
                ];


            if(!signature){

                console.warn(
                    "Webhook: missing signature."
                );

                return res.sendStatus(200);

            }


            /*
            -------------------------------------------------
            VERIFY RAW PAYSTACK SIGNATURE
            -------------------------------------------------
            */

            const expectedSignature =
                crypto
                    .createHmac(
                        "sha512",
                        secretKey
                    )
                    .update(
                        req.rawBody
                    )
                    .digest("hex");


            const signaturesMatch =
                crypto.timingSafeEqual(
                    Buffer.from(
                        signature
                    ),
                    Buffer.from(
                        expectedSignature
                    )
                );


            if(!signaturesMatch){

                console.warn(
                    "Webhook: invalid Paystack signature."
                );

                return res.sendStatus(200);

            }


            const event =
                req.body;


            console.log(
                "Paystack event:",
                event.event
            );


            /*
            -------------------------------------------------
            ONLY PROCESS SUCCESSFUL CHARGES
            -------------------------------------------------
            */

            if(
                event.event !==
                "charge.success"
            ){

                return res.sendStatus(200);

            }


            const payment =
                event.data || {};


            const reference =
                payment.reference;


            const amount =
                Number(
                    payment.amount || 0
                );


            const currency =
                payment.currency;


            console.log(
                "Successful payment:",
                {
                    reference,
                    amount,
                    currency
                }
            );


            /*
            -------------------------------------------------
            FIRESTORE REQUIRED
            -------------------------------------------------
            */

            if(!db){

                console.error(
                    "Webhook: Firestore unavailable."
                );

                return res.sendStatus(200);

            }


            if(!reference){

                console.warn(
                    "Webhook: payment has no reference."
                );

                return res.sendStatus(200);

            }


            /*
            -------------------------------------------------
            FIND ORDER BY PAYMENT REFERENCE
            -------------------------------------------------
            */

            const ordersSnapshot =
                await db
                    .collection("orders")
                    .where(
                        "paymentReference",
                        "==",
                        reference
                    )
                    .limit(1)
                    .get();


            if(
                ordersSnapshot.empty
            ){

                console.warn(
                    "Webhook: no order found for reference:",
                    reference
                );

                return res.sendStatus(200);

            }


            const orderDoc =
                ordersSnapshot.docs[0];


            const order =
                orderDoc.data();


            /*
            -------------------------------------------------
            VERIFY ORDER AMOUNT
            -------------------------------------------------
            */

            const expectedAmount =
                Math.round(
                    Number(
                        order.price || 0
                    ) * 100
                );


            if(
                amount !==
                expectedAmount
            ){

                console.error(
                    "Webhook amount mismatch:",
                    {
                        reference,
                        expectedAmount,
                        receivedAmount:
                            amount
                    }
                );

                return res.sendStatus(200);

            }


            /*
            -------------------------------------------------
            PREVENT DUPLICATE PROCESSING
            -------------------------------------------------
            */

            if(
                order.paymentStatus ===
                "Paid"
            ){

                console.log(
                    "Order already marked Paid:",
                    orderDoc.id
                );

                return res.sendStatus(200);

            }


            /*
            -------------------------------------------------
            MARK ORDER AS PAID
            -------------------------------------------------
            */

            await orderDoc.ref.update({

                paymentStatus:
                    "Paid",

                paymentProvider:
                    "Paystack",

                paymentChannel:
                    payment.channel ||
                    "bank_transfer",

                paymentConfirmedAt:
                    admin.firestore.FieldValue.serverTimestamp(),

                paymentTransactionId:
                    payment.id ||
                    null,

                status:
                    "Activating"

            });


            console.log(
                "ORDER MARKED PAID:",
                orderDoc.id
            );


            /*
            -------------------------------------------------
            NUMBER ACTIVATION
            -------------------------------------------------

            TWILIO ACTIVATION WILL BE CONNECTED HERE.

            Current lifecycle:

            Awaiting payment
                    ↓
                  Paid
                    ↓
                Activating
                    ↓
                  Active

            -------------------------------------------------
            */


            return res.sendStatus(200);

        }


        catch(error){

            console.error(
                "Paystack webhook error:",
                error
            );

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