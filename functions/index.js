const express = require("express");
const crypto = require("crypto");
const admin = require("firebase-admin");
const twilio = require("twilio");

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
CONFIGURATION
=========================================================
*/

const NUMORA_BACKEND_URL =
    process.env.NUMORA_BACKEND_URL ||
    "https://numora-backend-cle6.onrender.com";

const TWILIO_INCOMING_SMS_URL =
    `${NUMORA_BACKEND_URL}/api/twilio/incoming-sms`;


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
TWILIO CLIENT
=========================================================
*/

function getTwilioClient(){

    const accountSid =
        process.env.TWILIO_ACCOUNT_SID;

    const authToken =
        process.env.TWILIO_AUTH_TOKEN;


    if(
        !accountSid ||
        !authToken
    ){

        return null;

    }


    return twilio(
        accountSid,
        authToken
    );

}


/*
=========================================================
FIRESTORE TIMESTAMP
=========================================================
*/

function serverTimestamp(){

    return admin.firestore.FieldValue
        .serverTimestamp();

}


/*
=========================================================
NORMALIZE PHONE NUMBER
=========================================================
*/

function normalizePhoneNumber(value){

    if(!value){

        return "";

    }

    return String(value)
        .trim()
        .replace(/\s+/g, "");

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
                    : "not connected",

            twilio:
                process.env.TWILIO_ACCOUNT_SID &&
                process.env.TWILIO_AUTH_TOKEN
                    ? "configured"
                    : "not configured",

            paystack:
                process.env.PAYSTACK_SECRET_KEY
                    ? "configured"
                    : "not configured"

        });

    }
);


/*
=========================================================
TWILIO TEST
=========================================================

IMPORTANT:

This endpoint ONLY tests the Twilio connection and
searches available numbers.

It DOES NOT purchase a number.

=========================================================
*/

app.get(
    "/api/twilio/test",
    async (req, res) => {

        try {

            const accountSid =
                process.env.TWILIO_ACCOUNT_SID;

            const authToken =
                process.env.TWILIO_AUTH_TOKEN;


            if(
                !accountSid ||
                !authToken
            ){

                return res.status(500).json({

                    success: false,

                    twilio:
                        "not configured",

                    message:
                        "Twilio Account SID or Auth Token is missing from Render environment variables."

                });

            }


            const client =
                getTwilioClient();


            if(!client){

                return res.status(500).json({

                    success: false,

                    twilio:
                        "not connected",

                    message:
                        "Unable to create Twilio client."

                });

            }


            const account =
                await client
                    .api
                    .accounts(accountSid)
                    .fetch();


            const availableNumbers =
                await client
                    .availablePhoneNumbers("US")
                    .local
                    .list({

                        smsEnabled:
                            true,

                        voiceEnabled:
                            true,

                        limit:
                            5

                    });


            return res.status(200).json({

                success: true,

                twilio:
                    "connected",

                account: {

                    sid:
                        account.sid,

                    status:
                        account.status,

                    type:
                        account.type

                },

                availableNumbers:
                    availableNumbers.map(
                        number => ({

                            phoneNumber:
                                number.phoneNumber,

                            friendlyName:
                                number.friendlyName,

                            locality:
                                number.locality,

                            region:
                                number.region,

                            isoCountry:
                                number.isoCountry,

                            capabilities:
                                number.capabilities

                        })
                    ),

                message:
                    "Twilio connection is working. Available numbers were searched successfully. No number was purchased."

            });

        }


        catch(error){

            console.error(
                "Twilio test error:",
                error
            );


            return res.status(500).json({

                success: false,

                twilio:
                    "connection failed",

                message:
                    error.message ||
                    "Unable to connect to Twilio."

            });

        }

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
FIND ORDER BY PAYMENT REFERENCE
=========================================================
*/

async function findOrderByPaymentReference(
    reference
){

    if(!db){

        return null;

    }


    const snapshot =
        await db
            .collection("orders")
            .where(
                "paymentReference",
                "==",
                reference
            )
            .limit(1)
            .get();


    if(snapshot.empty){

        return null;

    }


    return snapshot.docs[0];

}


/*
=========================================================
VERIFY PAYSTACK TRANSACTION
=========================================================
*/

async function verifyPaystackTransaction(
    reference
){

    const secretKey =
        getPaystackSecretKey();


    if(!secretKey){

        throw new Error(
            "Paystack secret key is not configured."
        );

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

        throw new Error(
            result.message ||
            "Unable to verify Paystack transaction."
        );

    }


    return result.data || {};

}


/*
=========================================================
PROVISION EXACT TWILIO NUMBER
=========================================================

IMPORTANT:

This function purchases ONLY the exact number selected
by the customer.

It does NOT silently replace an unavailable number.

=========================================================
*/

async function provisionOrder(
    orderDoc
){

    if(!db){

        throw new Error(
            "Firestore is unavailable."
        );

    }


    const client =
        getTwilioClient();


    if(!client){

        throw new Error(
            "Twilio is not configured."
        );

    }


    const orderRef =
        orderDoc.ref;

    const order =
        orderDoc.data();


    /*
    -------------------------------------------------------
    ALREADY ACTIVE
    -------------------------------------------------------
    */

    if(
        order.provisioningStatus ===
        "Active"
        ||
        order.status ===
        "Active"
    ){

        return {

            success: true,

            alreadyActive: true,

            phoneNumber:
                order.phoneNumber,

            sid:
                order.twilioPhoneNumberSid

        };

    }


    /*
    -------------------------------------------------------
    CHECK REQUIRED NUMBER
    -------------------------------------------------------
    */

    const selectedNumber =
        normalizePhoneNumber(
            order.phoneNumber
        );


    if(!selectedNumber){

        await orderRef.update({

            status:
                "Provisioning error",

            provisioningStatus:
                "Failed",

            provisioningError:
                "The order does not contain a selected phone number.",

            provisioningUpdatedAt:
                serverTimestamp()

        });


        throw new Error(
            "Order does not contain a selected phone number."
        );

    }


    /*
    -------------------------------------------------------
    ATOMIC PROVISIONING LOCK
    -------------------------------------------------------
    */

    const lockResult =
        await db.runTransaction(
            async transaction => {

                const freshSnapshot =
                    await transaction.get(
                        orderRef
                    );


                if(!freshSnapshot.exists){

                    return {

                        locked: false,

                        reason:
                            "missing"

                    };

                }


                const freshOrder =
                    freshSnapshot.data();


                if(
                    freshOrder.provisioningStatus ===
                    "Active"
                    ||
                    freshOrder.status ===
                    "Active"
                ){

                    return {

                        locked: false,

                        reason:
                            "already-active",

                        phoneNumber:
                            freshOrder.phoneNumber,

                        sid:
                            freshOrder.twilioPhoneNumberSid

                    };

                }


                if(
                    freshOrder.provisioningStatus ===
                    "Processing"
                ){

                    return {

                        locked: false,

                        reason:
                            "already-processing"

                    };

                }


                transaction.update(
                    orderRef,
                    {

                        provisioningStatus:
                            "Processing",

                        provisioningStartedAt:
                            serverTimestamp(),

                        status:
                            "Activating"

                    }
                );


                return {

                    locked: true,

                    reason:
                        "locked"

                };

            }
        );


    if(
        !lockResult.locked
    ){

        if(
            lockResult.reason ===
            "already-active"
        ){

            return {

                success: true,

                alreadyActive: true,

                phoneNumber:
                    lockResult.phoneNumber,

                sid:
                    lockResult.sid

            };

        }


        if(
            lockResult.reason ===
            "already-processing"
        ){

            return {

                success: true,

                alreadyProcessing: true

            };

        }


        throw new Error(
            "Unable to start provisioning."
        );

    }


    /*
    -------------------------------------------------------
    RE-CHECK ORDER
    -------------------------------------------------------
    */

    const currentSnapshot =
        await orderRef.get();


    if(!currentSnapshot.exists){

        throw new Error(
            "Order no longer exists."
        );

    }


    const currentOrder =
        currentSnapshot.data();


    /*
    -------------------------------------------------------
    VERIFY NUMBER IS STILL AVAILABLE
    -------------------------------------------------------

    We search Twilio inventory for the exact number.

    If it is gone, we DO NOT purchase another number.
    -------------------------------------------------------
    */

    let exactNumberAvailable =
        false;


    try {

        const availableNumbers =
            await client
                .availablePhoneNumbers(
                    "US"
                )
                .local
                .list({

                    phoneNumber:
                        selectedNumber,

                    smsEnabled:
                        true,

                    voiceEnabled:
                        true,

                    limit:
                        1

                });


        exactNumberAvailable =
            availableNumbers.some(
                number =>
                    normalizePhoneNumber(
                        number.phoneNumber
                    ) ===
                    selectedNumber
            );

    }

    catch(error){

        console.error(
            "Exact number availability check failed:",
            error
        );


        await orderRef.update({

            status:
                "Provisioning error",

            provisioningStatus:
                "Failed",

            provisioningError:
                error.message ||
                "Unable to verify selected number availability.",

            provisioningUpdatedAt:
                serverTimestamp()

        });


        throw error;

    }


    if(!exactNumberAvailable){

        await orderRef.update({

            status:
                "Number unavailable",

            provisioningStatus:
                "Unavailable",

            twilioPurchaseStatus:
                "Not purchased",

            provisioningError:
                "The selected Twilio number is no longer available.",

            provisioningUpdatedAt:
                serverTimestamp()

        });


        return {

            success: false,

            unavailable: true,

            message:
                "The selected number is no longer available."

        };

    }


    /*
    -------------------------------------------------------
    PURCHASE EXACT NUMBER
    -------------------------------------------------------
    */

    let purchasedNumber;


    try {

        purchasedNumber =
            await client
                .incomingPhoneNumbers
                .create({

                    phoneNumber:
                        selectedNumber,

                    smsUrl:
                        TWILIO_INCOMING_SMS_URL,

                    smsMethod:
                        "POST"

                });

    }

    catch(error){

        console.error(
            "Twilio number purchase failed:",
            error
        );


        await orderRef.update({

            status:
                "Provisioning error",

            provisioningStatus:
                "Failed",

            twilioPurchaseStatus:
                "Failed",

            provisioningError:
                error.message ||
                "Twilio could not purchase the selected number.",

            provisioningUpdatedAt:
                serverTimestamp()

        });


        throw error;

    }


    /*
    -------------------------------------------------------
    SAVE SUCCESSFUL PROVISIONING
    -------------------------------------------------------
    */

    const purchasedAt =
        admin.firestore.Timestamp.now();


    await orderRef.update({

        status:
            "Active",

        paymentStatus:
            "Paid",

        provisioningStatus:
            "Active",

        twilioPurchaseStatus:
            "Purchased",

        twilioPhoneNumberSid:
            purchasedNumber.sid,

        phoneNumber:
            purchasedNumber.phoneNumber,

        twilioPhoneNumber:
            purchasedNumber.phoneNumber,

        twilioFriendlyName:
            purchasedNumber.friendlyName ||
            null,

        twilioSmsUrl:
            TWILIO_INCOMING_SMS_URL,

        activatedAt:
            purchasedAt,

        provisioningCompletedAt:
            purchasedAt,

        provisioningError:
            null,

        provisioningUpdatedAt:
            purchasedAt

    });


    console.log(
        "TWILIO NUMBER PURCHASED:",
        {
            orderId:
                orderDoc.id,

            phoneNumber:
                purchasedNumber.phoneNumber,

            sid:
                purchasedNumber.sid

        }
    );


    return {

        success: true,

        active: true,

        phoneNumber:
            purchasedNumber.phoneNumber,

        sid:
            purchasedNumber.sid

    };

}


/*
=========================================================
PROCESS VERIFIED PAYMENT
=========================================================
*/

async function processVerifiedPayment(
    orderDoc,
    payment
){

    const orderRef =
        orderDoc.ref;

    const order =
        orderDoc.data();


    const expectedAmount =
        Math.round(
            Number(
                order.price || 0
            ) * 100
        );


    const paidAmount =
        Number(
            payment.amount || 0
        );


    if(
        paidAmount !==
        expectedAmount
    ){

        await orderRef.update({

            paymentStatus:
                "Amount mismatch",

            status:
                "Payment amount mismatch",

            paymentError:
                "The Paystack payment amount does not match the order amount.",

            paymentUpdatedAt:
                serverTimestamp()

        });


        return {

            success: false,

            amountMismatch: true

        };

    }


    /*
    -------------------------------------------------------
    ALREADY PAID
    -------------------------------------------------------
    */

    if(
        order.paymentStatus ===
        "Paid"
        &&
        (
            order.provisioningStatus ===
            "Active"
            ||
            order.status ===
            "Active"
        )
    ){

        return {

            success: true,

            alreadyActive: true

        };

    }


    /*
    -------------------------------------------------------
    MARK PAYMENT PAID
    -------------------------------------------------------
    */

    await orderRef.update({

        paymentStatus:
            "Paid",

        paymentProvider:
            "Paystack",

        paymentChannel:
            payment.channel ||
            "bank_transfer",

        paymentConfirmedAt:
            order.paymentConfirmedAt ||
            serverTimestamp(),

        paymentTransactionId:
            payment.id ||
            order.paymentTransactionId ||
            null,

        status:
            "Activating",

        paymentError:
            null

    });


    console.log(
        "ORDER PAYMENT CONFIRMED:",
        orderDoc.id
    );


    /*
    -------------------------------------------------------
    PROVISION TWILIO NUMBER
    -------------------------------------------------------
    */

    return await provisionOrder(
        orderDoc
    );

}


/*
=========================================================
VERIFY PAYMENT
=========================================================
*/

app.post(
    "/api/paystack/verify",
    async (req, res) => {

        try {

            const {
                reference
            } = req.body;


            if(!reference){

                return res.status(400).json({

                    success: false,

                    message:
                        "Payment reference is required."

                });

            }


            if(!db){

                return res.status(500).json({

                    success: false,

                    message:
                        "Firestore is unavailable."

                });

            }


            const orderDoc =
                await findOrderByPaymentReference(
                    reference
                );


            if(!orderDoc){

                return res.status(404).json({

                    success: false,

                    paid: false,

                    message:
                        "No Numora order was found for this payment reference."

                });

            }


            const order =
                orderDoc.data();


            /*
            -------------------------------------------------
            VERIFY TRANSACTION DIRECTLY WITH PAYSTACK
            -------------------------------------------------
            */

            const transaction =
                await verifyPaystackTransaction(
                    reference
                );


            const expectedAmount =
                Math.round(
                    Number(
                        order.price || 0
                    ) * 100
                );


            const paidAmount =
                Number(
                    transaction.amount || 0
                );


            const amountMatches =
                paidAmount ===
                expectedAmount;


            if(
                transaction.status !==
                "success"
            ){

                return res.status(200).json({

                    success: true,

                    paid: false,

                    status:
                        transaction.status ||
                        "unknown",

                    reference:
                        transaction.reference ||
                        reference,

                    message:
                        "Payment has not been confirmed yet."

                });

            }


            if(!amountMatches){

                return res.status(200).json({

                    success: true,

                    paid: false,

                    amountMismatch:
                        true,

                    status:
                        transaction.status,

                    amount:
                        paidAmount,

                    expectedAmount:
                        expectedAmount,

                    message:
                        "Payment was received, but the amount does not match the order."

                });

            }


            /*
            -------------------------------------------------
            PAYMENT IS VERIFIED

            The backend now also activates the number.
            -------------------------------------------------
            */

            const provisioningResult =
                await processVerifiedPayment(
                    orderDoc,
                    transaction
                );


            return res.status(200).json({

                success: true,

                paid: true,

                status:
                    transaction.status,

                reference:
                    transaction.reference ||
                    reference,

                amount:
                    paidAmount,

                currency:
                    transaction.currency,

                paidAt:
                    transaction.paid_at ||
                    null,

                activation:
                    provisioningResult

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
                    error.message ||
                    "Unable to verify payment."

            });

        }

    }
);


/*
=========================================================
PAYSTACK WEBHOOK
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


            const receivedBuffer =
                Buffer.from(
                    signature,
                    "utf8"
                );

            const expectedBuffer =
                Buffer.from(
                    expectedSignature,
                    "utf8"
                );


            if(
                receivedBuffer.length !==
                expectedBuffer.length
            ){

                console.warn(
                    "Webhook: invalid signature length."
                );

                return res.sendStatus(200);

            }


            const signaturesMatch =
                crypto.timingSafeEqual(
                    receivedBuffer,
                    expectedBuffer
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


            const orderDoc =
                await findOrderByPaymentReference(
                    reference
                );


            if(!orderDoc){

                console.warn(
                    "Webhook: no order found for reference:",
                    reference
                );

                return res.sendStatus(200);

            }


            const order =
                orderDoc.data();


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

                await orderDoc.ref.update({

                    paymentStatus:
                        "Amount mismatch",

                    status:
                        "Payment amount mismatch",

                    paymentError:
                        "Paystack amount does not match the Numora order.",

                    paymentUpdatedAt:
                        serverTimestamp()

                });


                return res.sendStatus(200);

            }


            /*
            -------------------------------------------------
            IDEMPOTENCY

            Even if Paystack sends the webhook multiple times,
            provisioning is protected.
            -------------------------------------------------
            */

            if(
                order.provisioningStatus ===
                "Active"
                ||
                order.status ===
                "Active"
            ){

                console.log(
                    "Order already active:",
                    orderDoc.id
                );

                return res.sendStatus(200);

            }


            /*
            -------------------------------------------------
            PROCESS PAYMENT + PROVISION NUMBER
            -------------------------------------------------
            */

            try {

                await processVerifiedPayment(
                    orderDoc,
                    payment
                );

            }

            catch(error){

                console.error(
                    "Webhook provisioning error:",
                    error
                );

            }


            return res.sendStatus(200);

        }


        catch(error){

            console.error(
                "Paystack webhook error:",
                error
            );

            /*
            Always acknowledge Paystack so it does not
            repeatedly hammer the endpoint.
            */

            return res.sendStatus(200);

        }

    }
);


/*
=========================================================
TWILIO INCOMING SMS WEBHOOK
=========================================================

Twilio sends incoming SMS messages here.

The webhook finds the active Numora order that owns
the receiving Twilio number and stores the message
inside:

orders/{orderId}/messages/{messageId}

=========================================================
*/

app.post(
    "/api/twilio/incoming-sms",
    async (req, res) => {

        try {

            const {

                MessageSid,
                SmsSid,
                AccountSid,
                From,
                To,
                Body,
                NumMedia

            } = req.body;


            console.log(
                "Incoming Twilio SMS:",
                {
                    MessageSid,
                    SmsSid,
                    AccountSid,
                    From,
                    To
                }
            );


            if(!db){

                console.error(
                    "Incoming SMS: Firestore unavailable."
                );

                return res
                    .type("text/xml")
                    .send(
                        "<Response></Response>"
                    );

            }


            const receivingNumber =
                normalizePhoneNumber(
                    To
                );


            if(!receivingNumber){

                console.warn(
                    "Incoming SMS: missing To number."
                );

                return res
                    .type("text/xml")
                    .send(
                        "<Response></Response>"
                    );

            }


            /*
            -------------------------------------------------
            FIND ORDER BY PURCHASED NUMBER
            -------------------------------------------------
            */

            const orderSnapshot =
                await db
                    .collection("orders")
                    .where(
                        "phoneNumber",
                        "==",
                        receivingNumber
                    )
                    .where(
                        "provisioningStatus",
                        "==",
                        "Active"
                    )
                    .limit(1)
                    .get();


            let orderDoc =
                orderSnapshot.empty
                    ? null
                    : orderSnapshot.docs[0];


            /*
            -------------------------------------------------
            FALLBACK TO TWILIO PHONE NUMBER FIELD
            -------------------------------------------------
            */

            if(!orderDoc){

                const fallbackSnapshot =
                    await db
                        .collection("orders")
                        .where(
                            "twilioPhoneNumber",
                            "==",
                            receivingNumber
                        )
                        .where(
                            "provisioningStatus",
                            "==",
                            "Active"
                        )
                        .limit(1)
                        .get();


                if(
                    !fallbackSnapshot.empty
                ){

                    orderDoc =
                        fallbackSnapshot.docs[0];

                }

            }


            if(!orderDoc){

                console.warn(
                    "Incoming SMS: no active Numora order found for:",
                    receivingNumber
                );

                return res
                    .type("text/xml")
                    .send(
                        "<Response></Response>"
                    );

            }


            const orderId =
                orderDoc.id;


            /*
            -------------------------------------------------
            SAVE MESSAGE
            -------------------------------------------------
            */

            const messageId =
                MessageSid ||
                SmsSid ||
                crypto.randomUUID();


            const messageRef =
                orderDoc.ref
                    .collection("messages")
                    .doc(
                        messageId
                    );


            const messageData = {

                messageSid:
                    MessageSid ||
                    SmsSid ||
                    null,

                smsSid:
                    SmsSid ||
                    MessageSid ||
                    null,

                accountSid:
                    AccountSid ||
                    null,

                from:
                    From ||
                    null,

                to:
                    To ||
                    null,

                body:
                    Body ||
                    "",

                numMedia:
                    Number(
                        NumMedia || 0
                    ),

                receivedAt:
                    serverTimestamp(),

                type:
                    "SMS"

            };


            await messageRef.set(
                messageData,
                {
                    merge: true
                }
            );


            /*
            -------------------------------------------------
            UPDATE ORDER WITH LATEST MESSAGE
            -------------------------------------------------
            */

            await orderDoc.ref.update({

                lastMessage:
                    Body ||
                    "",

                lastMessageFrom:
                    From ||
                    null,

                lastMessageTo:
                    To ||
                    null,

                lastMessageSid:
                    MessageSid ||
                    SmsSid ||
                    null,

                lastMessageAt:
                    serverTimestamp(),

                lastMessageReceivedAt:
                    serverTimestamp(),

                messageCount:
                    admin.firestore.FieldValue
                        .increment(1)

            });


            console.log(
                "Incoming SMS saved:",
                {
                    orderId,
                    messageId
                }
            );


            /*
            -------------------------------------------------
            TWILIO RESPONSE

            No automatic reply is sent.
            -------------------------------------------------
            */

            return res
                .type("text/xml")
                .send(
                    "<Response></Response>"
                );

        }


        catch(error){

            console.error(
                "Incoming SMS webhook error:",
                error
            );


            return res
                .type("text/xml")
                .send(
                    "<Response></Response>"
                );

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

        console.log(
            "Twilio incoming SMS URL:",
            TWILIO_INCOMING_SMS_URL
        );

    }
);