const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const crypto = require("crypto");

admin.initializeApp();

const db = admin.firestore();

/*
=========================================================
PAYSTACK SECRET
=========================================================
*/

const PAYSTACK_SECRET_KEY =
    defineSecret("PAYSTACK_SECRET_KEY");


/*
=========================================================
CREATE BANK TRANSFER PAYMENT
=========================================================
*/

exports.createBankTransfer = onRequest(
    {
        secrets: [PAYSTACK_SECRET_KEY],
        cors: true
    },
    async (req, res) => {

        try {

            if (req.method !== "POST") {
                return res.status(405).json({
                    success: false,
                    message: "Method not allowed."
                });
            }


            /*
            -------------------------------------------------
            GET ORDER ID
            -------------------------------------------------
            */

            const {
                orderId
            } = req.body || {};


            if (!orderId) {

                return res.status(400).json({
                    success: false,
                    message: "Order ID is required."
                });

            }


            /*
            -------------------------------------------------
            GET ORDER FROM FIRESTORE
            -------------------------------------------------
            */

            const orderRef =
                db.collection("orders").doc(orderId);

            const orderSnapshot =
                await orderRef.get();


            if (!orderSnapshot.exists) {

                return res.status(404).json({
                    success: false,
                    message: "Order not found."
                });

            }


            const order =
                orderSnapshot.data();


            /*
            -------------------------------------------------
            MAKE SURE ORDER IS NOT ALREADY PAID
            -------------------------------------------------
            */

            if (
                order.paymentStatus === "Paid"
            ) {

                return res.status(400).json({
                    success: false,
                    message: "This order has already been paid."
                });

            }


            /*
            -------------------------------------------------
            CHECK CUSTOMER EMAIL
            -------------------------------------------------
            */

            if (!order.customerEmail) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Customer email is missing from this order."
                });

            }


            /*
            -------------------------------------------------
            CHECK PRICE
            -------------------------------------------------
            */

            const amountNGN =
                Number(order.price || 0);


            if (
                !Number.isFinite(amountNGN) ||
                amountNGN <= 0
            ) {

                return res.status(400).json({
                    success: false,
                    message: "Invalid order amount."
                });

            }


            /*
            -------------------------------------------------
            PAYSTACK USES KOBO
            -------------------------------------------------
            */

            const amountKobo =
                Math.round(amountNGN * 100);


            /*
            -------------------------------------------------
            UNIQUE NUMORA REFERENCE
            -------------------------------------------------
            */

            const reference =
                `NUMORA-${orderId}-${Date.now()}`;


            /*
            -------------------------------------------------
            BANK TRANSFER ACCOUNT EXPIRY
            -------------------------------------------------

            Paystack currently limits this to 25 minutes
            for Pay with Transfer.
            -------------------------------------------------
            */

            const expiresAt =
                new Date(
                    Date.now() +
                    20 * 60 * 1000
                ).toISOString();


            /*
            -------------------------------------------------
            CALL PAYSTACK
            -------------------------------------------------
            */

            const paystackResponse =
                await fetch(
                    "https://api.paystack.co/charge",
                    {
                        method: "POST",

                        headers: {
                            "Authorization":
                                `Bearer ${PAYSTACK_SECRET_KEY.value()}`,

                            "Content-Type":
                                "application/json"
                        },

                        body: JSON.stringify({

                            email:
                                order.customerEmail,

                            amount:
                                String(amountKobo),

                            currency:
                                "NGN",

                            reference:
                                reference,

                            bank_transfer: {
                                account_expires_at:
                                    expiresAt
                            }

                        })
                    }
                );


            const paystackData =
                await paystackResponse.json();


            /*
            -------------------------------------------------
            PAYSTACK ERROR
            -------------------------------------------------
            */

            if (
                !paystackResponse.ok ||
                !paystackData.status
            ) {

                console.error(
                    "Paystack error:",
                    paystackData
                );

                return res.status(502).json({
                    success: false,
                    message:
                        paystackData.message ||
                        "Paystack could not create the bank transfer."
                });

            }


            const payment =
                paystackData.data;


            /*
            -------------------------------------------------
            SAVE PAYMENT DETAILS
            -------------------------------------------------
            */

            await orderRef.update({

                paymentStatus:
                    "Pending",

                paymentReference:
                    payment.reference || reference,

                paymentChannel:
                    "bank_transfer",

                bankName:
                    payment.bank?.name || "",

                bankAccountNumber:
                    payment.account_number || "",

                bankAccountName:
                    payment.account_name || "",

                paymentExpiresAt:
                    payment.account_expires_at || null,

                paymentCreatedAt:
                    admin.firestore.FieldValue.serverTimestamp()

            });


            /*
            -------------------------------------------------
            SEND DETAILS BACK TO PAYMENT PAGE
            -------------------------------------------------
            */

            return res.status(200).json({

                success: true,

                payment: {

                    reference:
                        payment.reference ||
                        reference,

                    status:
                        payment.status ||
                        "pending_bank_transfer",

                    displayText:
                        payment.display_text ||
                        "Please make a transfer to the account specified.",

                    accountName:
                        payment.account_name ||
                        "",

                    accountNumber:
                        payment.account_number ||
                        "",

                    bankName:
                        payment.bank?.name ||
                        "",

                    expiresAt:
                        payment.account_expires_at ||
                        null,

                    amount:
                        amountNGN,

                    currency:
                        "NGN"

                }

            });


        } catch (error) {

            console.error(
                "createBankTransfer error:",
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
PAYSTACK WEBHOOK
=========================================================
*/

exports.paystackWebhook = onRequest(
    {
        secrets: [PAYSTACK_SECRET_KEY]
    },
    async (req, res) => {

        try {

            /*
            -------------------------------------------------
            ONLY POST
            -------------------------------------------------
            */

            if (req.method !== "POST") {

                return res.status(405).send(
                    "Method not allowed."
                );

            }


            /*
            -------------------------------------------------
            VERIFY PAYSTACK SIGNATURE
            -------------------------------------------------
            */

            const signature =
                req.headers[
                    "x-paystack-signature"
                ];


            if (!signature) {

                return res.status(401).send(
                    "Missing signature."
                );

            }


            const rawBody =
                req.rawBody;


            const expectedSignature =
                crypto
                    .createHmac(
                        "sha512",
                        PAYSTACK_SECRET_KEY.value()
                    )
                    .update(rawBody)
                    .digest("hex");


            if (
                signature !==
                expectedSignature
            ) {

                console.error(
                    "Invalid Paystack webhook signature."
                );

                return res.status(401).send(
                    "Invalid signature."
                );

            }


            /*
            -------------------------------------------------
            EVENT
            -------------------------------------------------
            */

            const event =
                req.body;


            console.log(
                "Paystack webhook:",
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
                    event.data;


                const reference =
                    payment.reference;


                if (!reference) {

                    return res.status(200).send(
                        "Webhook received."
                    );

                }


                /*
                -------------------------------------------------
                FIND ORDER USING PAYMENT REFERENCE
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


                if (
                    ordersSnapshot.empty
                ) {

                    console.warn(
                        "No Numora order found for:",
                        reference
                    );

                    return res.status(200).send(
                        "Webhook received."
                    );

                }


                const orderDoc =
                    ordersSnapshot.docs[0];


                const order =
                    orderDoc.data();


                /*
                -------------------------------------------------
                PREVENT DUPLICATE PROCESSING
                -------------------------------------------------
                */

                if (
                    order.paymentStatus ===
                    "Paid"
                ) {

                    return res.status(200).send(
                        "Already processed."
                    );

                }


                /*
                -------------------------------------------------
                VERIFY AMOUNT
                -------------------------------------------------
                */

                const expectedAmount =
                    Math.round(
                        Number(order.price || 0) *
                        100
                    );


                const paidAmount =
                    Number(
                        payment.amount || 0
                    );


                if (
                    paidAmount !==
                    expectedAmount
                ) {

                    console.error(
                        "Payment amount mismatch:",
                        {
                            reference,
                            expectedAmount,
                            paidAmount
                        }
                    );

                    await orderDoc.ref.update({

                        paymentStatus:
                            "Amount mismatch",

                        paymentUpdatedAt:
                            admin.firestore.FieldValue
                                .serverTimestamp()

                    });

                    return res.status(200).send(
                        "Amount mismatch recorded."
                    );

                }


                /*
                -------------------------------------------------
                MARK ORDER AS PAID
                -------------------------------------------------
                */

                await orderDoc.ref.update({

                    paymentStatus:
                        "Paid",

                    status:
                        "Paid",

                    paidAt:
                        admin.firestore.FieldValue
                            .serverTimestamp(),

                    paymentChannel:
                        payment.channel ||
                        "bank_transfer",

                    paystackTransactionId:
                        payment.id || null

                });


                console.log(
                    "Numora order marked PAID:",
                    orderDoc.id
                );

            }


            /*
            -------------------------------------------------
            ALWAYS ACKNOWLEDGE PAYSTACK
            -------------------------------------------------
            */

            return res.status(200).send(
                "Webhook received."
            );


        } catch (error) {

            console.error(
                "paystackWebhook error:",
                error
            );

            return res.status(500).send(
                "Webhook error."
            );

        }

    }
);