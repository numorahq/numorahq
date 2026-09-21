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
5SIM CONFIGURATION
=========================================================

5SIM is an additional provider.

Twilio and Paystack remain fully intact.

The 5SIM API key is stored only on Render and is never
sent to the browser.

The catalog and live price endpoints below use 5SIM's
public guest API. The authenticated helper is kept ready
for the later number-purchase/SMS-order stage.

=========================================================
*/

const FIVESIM_API_BASE =
    "https://5sim.net/v1";

const FIVESIM_REQUEST_TIMEOUT =
    10000;

function get5SimApiKey(){

    return process.env.FIVESIM_API_KEY;

}


/*
---------------------------------------------------------
5SIM GENERIC REQUEST
---------------------------------------------------------
*/

async function fetch5Sim(
    url,
    options = {}
){

    const controller =
        new AbortController();

    const timeout =
        setTimeout(
            () => {
                controller.abort();
            },
            FIVESIM_REQUEST_TIMEOUT
        );

    try {

        const response =
            await fetch(
                url,
                {
                    ...options,

                    signal:
                        controller.signal,

                    headers: {

                        "Accept":
                            "application/json",

                        ...(options.headers || {})

                    }

                }
            );

        const text =
            await response.text();

        let data;

        try {

            data =
                text
                    ? JSON.parse(text)
                    : {};

        }
        catch(error){

            data = {

                message:
                    text ||
                    "5SIM returned an invalid response."

            };

        }

        if(!response.ok){

            const message =
                data?.message ||
                data?.error ||
                (
                    typeof data === "string"
                        ? data
                        : null
                ) ||
                `5SIM request failed with status ${response.status}.`;

            const error =
                new Error(message);

            error.status =
                response.status;

            error.data =
                data;

            throw error;

        }

        return data;

    }
    catch(error){

        if(
            error.name ===
            "AbortError"
        ){

            throw new Error(
                "5SIM request timed out."
            );

        }

        throw error;

    }
    finally {

        clearTimeout(timeout);

    }

}


/*
---------------------------------------------------------
5SIM AUTHENTICATED REQUEST
---------------------------------------------------------

Used by authenticated 5SIM operations later:
- account/profile
- buying activation numbers
- checking orders/SMS
- finishing orders
- cancelling/banning orders

The API key never leaves Render.
---------------------------------------------------------
*/

async function fetch5SimAuthenticated(
    path,
    options = {}
){

    const token =
        get5SimApiKey();

    if(!token){

        throw new Error(
            "FIVESIM_API_KEY is not configured on Render."
        );

    }

    return await fetch5Sim(
        `${FIVESIM_API_BASE}${path}`,
        {

            ...options,

            headers: {

                "Authorization":
                    `Bearer ${token}`,

                ...(options.headers || {})

            }

        }
    );

}


/*
---------------------------------------------------------
5SIM GUEST REQUEST
---------------------------------------------------------
*/

async function fetch5SimGuest(
    path
){

    return await fetch5Sim(
        `${FIVESIM_API_BASE}${path}`,
        {

            method:
                "GET"

        }
    );

}


/*
---------------------------------------------------------
5SIM CACHE
---------------------------------------------------------

Small in-memory cache prevents repeated admin requests
from unnecessarily hitting 5SIM.

The cache is lost automatically if Render restarts, which
is intentional because 5SIM availability/pricing is live.
---------------------------------------------------------
*/

const fiveSimCache = {

    countries: {

        data: null,

        expiresAt: 0

    },

    services: new Map(),

    prices: new Map()

};

const FIVESIM_COUNTRIES_CACHE_MS =
    5 * 60 * 1000;

const FIVESIM_SERVICES_CACHE_MS =
    60 * 1000;

const FIVESIM_PRICES_CACHE_MS =
    30 * 1000;


/*
---------------------------------------------------------
NORMALIZE 5SIM IDENTIFIER
---------------------------------------------------------
*/

function normalize5SimValue(
    value
){

    return String(
        value || ""
    )
        .trim()
        .toLowerCase();

}


/*
---------------------------------------------------------
VALIDATE 5SIM IDENTIFIER
---------------------------------------------------------
*/

function validate5SimName(
    value,
    fieldName
){

    const normalized =
        normalize5SimValue(
            value
        );

    if(!normalized){

        throw new Error(
            `${fieldName} is required.`
        );

    }

    if(
        !/^[a-z0-9_-]+$/i.test(
            normalized
        )
    ){

        throw new Error(
            `Invalid ${fieldName}.`
        );

    }

    return normalized;

}


/*
=========================================================
CUSTOMER AUTHENTICATION
=========================================================

Customer requests must carry a Firebase ID token in:
Authorization: Bearer <firebase-id-token>

The token is verified on Render. The Firebase UID is then
used to read the customer's Firestore profile.
=========================================================
*/

async function authenticateCustomerRequest(req){

    if(!admin || !firebaseInitialized){

        throw new Error(
            "Firebase Admin is unavailable."
        );

    }

    const authorization =
        String(
            req.headers.authorization || ""
        );

    if(
        !authorization.toLowerCase().startsWith("bearer ")
    ){

        const error =
            new Error(
                "Authentication is required."
            );

        error.status = 401;

        throw error;

    }

    const idToken =
        authorization
            .slice(7)
            .trim();

    if(!idToken){

        const error =
            new Error(
                "Authentication token is missing."
            );

        error.status = 401;

        throw error;

    }

    try{

        return await admin
            .auth()
            .verifyIdToken(
                idToken
            );

    }
    catch(error){

        const authError =
            new Error(
                "Your session has expired. Please sign in again."
            );

        authError.status = 401;

        throw authError;

    }

}


/*
---------------------------------------------------------
CUSTOMER BALANCE FIELD
---------------------------------------------------------

The customer app currently supports these legacy/new names.
We use the first existing numeric field so the backend updates
whichever balance the customer's account is actually using.
---------------------------------------------------------
*/

function getCustomerBalanceField(
    userData
){

    if(
        userData &&
        typeof userData.balance === "number"
    ){

        return "balance";

    }

    if(
        userData &&
        typeof userData.nairaBalance === "number"
    ){

        return "nairaBalance";

    }

    if(
        userData &&
        typeof userData.walletBalance === "number"
    ){

        return "walletBalance";

    }

    /*
      New customer accounts use balance as the canonical field.
    */
    return "balance";

}


function getCustomerBalance(
    userData,
    field
){

    const value =
        Number(
            userData?.[field] ?? 0
        );

    return Number.isFinite(value)
        ? value
        : 0;

}


/*
---------------------------------------------------------
5SIM DELIVERY RATE
---------------------------------------------------------

5SIM normally exposes delivery rate as a percentage.
For safety, a fractional value such as 0.74 is also accepted
and normalized to 74.
---------------------------------------------------------
*/

function normalize5SimDeliveryRate(
    value
){

    if(
        value === null ||
        value === undefined ||
        value === ""
    ){

        return null;

    }

    const number =
        Number(value);

    if(!Number.isFinite(number)){

        return null;

    }

    if(
        number >= 0 &&
        number <= 1
    ){

        return number * 100;

    }

    return number;

}


/*
---------------------------------------------------------
5SIM OPERATOR SELECTION
---------------------------------------------------------

Numora's rule:
1. operator must have stock
2. delivery/success rate must be >= 70%
3. among qualifying operators, choose the cheapest
4. ties use higher delivery rate, then higher stock

There is NO fallback to an operator below 70%.
---------------------------------------------------------
*/

async function get5SimPurchaseOption(
    country,
    service
){

    const rawPrices =
        await fetch5SimGuest(
            `/guest/prices?country=${encodeURIComponent(country)}&product=${encodeURIComponent(service)}`
        );

    const countryData =
        rawPrices?.[country] ||
        {};

    const serviceData =
        countryData?.[service] ||
        {};

    const operators =
        Object.entries(
            serviceData
        )
        .map(
            ([operator, data]) => ({

                operator,

                cost:
                    Number(
                        data?.cost || 0
                    ),

                count:
                    Number(
                        data?.count || 0
                    ),

                rate:
                    normalize5SimDeliveryRate(
                        data?.rate
                    )

            })
        )
        .filter(
            item =>
                item.count > 0 &&
                item.cost > 0 &&
                item.rate !== null &&
                item.rate >= 70
        )
        .sort(
            (a, b) => {

                if(a.cost !== b.cost){
                    return a.cost - b.cost;
                }

                if(a.rate !== b.rate){
                    return b.rate - a.rate;
                }

                return b.count - a.count;

            }
        );

    return {

        selected:
            operators[0] || null,

        operators,

        totalOperators:
            Object.keys(
                serviceData
            ).length

    };

}


/*
---------------------------------------------------------
5SIM BUY ACTIVATION
---------------------------------------------------------

5SIM's authenticated activation purchase endpoint is a GET:
/user/buy/activation/{country}/{operator}/{product}

The API key stays on Render.
---------------------------------------------------------
*/

async function buy5SimActivation(
    country,
    operator,
    service
){

    return await fetch5SimAuthenticated(
        `/user/buy/activation/${encodeURIComponent(country)}/${encodeURIComponent(operator)}/${encodeURIComponent(service)}`,
        {

            method:
                "GET"

        }
    );

}


function normalize5SimPurchaseResponse(
    data
){

    const orderId =
        data?.id ??
        data?.order_id ??
        data?.orderId ??
        null;

    const phoneNumber =
        data?.phone ??
        data?.phoneNumber ??
        data?.number ??
        null;

    const status =
        data?.status ??
        null;

    return {

        orderId:
            orderId !== null
                ? String(orderId)
                : null,

        phoneNumber:
            phoneNumber
                ? normalizePhoneNumber(phoneNumber)
                : null,

        status,

        raw:
            data

    };

}


/*
---------------------------------------------------------
REFUND RESERVED CUSTOMER BALANCE
---------------------------------------------------------
*/

async function refundCustomerReservation(
    userRef,
    balanceField,
    amount,
    orderRef,
    reason
){

    try{

        await db.runTransaction(
            async transaction => {

                const userSnapshot =
                    await transaction.get(
                        userRef
                    );

                if(!userSnapshot.exists){

                    throw new Error(
                        "Customer profile no longer exists."
                    );

                }

                transaction.update(
                    userRef,
                    {

                        [balanceField]:
                            admin.firestore.FieldValue
                                .increment(
                                    amount
                                )

                    }
                );

                transaction.update(
                    orderRef,
                    {

                        status:
                            "Purchase failed",

                        purchaseStatus:
                            "Failed",

                        balanceReservation:
                            "Refunded",

                        refundAmountNaira:
                            amount,

                        refundReason:
                            reason ||
                            "5SIM purchase failed",

                        refundCompletedAt:
                            serverTimestamp(),

                        updatedAt:
                            serverTimestamp()

                    }
                );

            }
        );

        return true;

    }
    catch(error){

        console.error(
            "Customer balance refund failed:",
            error
        );

        try{

            await orderRef.update({

                status:
                    "Purchase failed",

                purchaseStatus:
                    "Failed - refund pending",

                balanceReservation:
                    "Refund pending",

                refundAmountNaira:
                    amount,

                refundReason:
                    reason ||
                    "5SIM purchase failed",

                refundError:
                    error.message ||
                    "Unable to refund reserved balance.",

                updatedAt:
                    serverTimestamp()

            });

        }
        catch(updateError){

            console.error(
                "Could not mark failed Numora order:",
                updateError
            );

        }

        return false;

    }
}


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

            fivesim:
                process.env.FIVESIM_API_KEY
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
5SIM — COUNTRIES
=========================================================

GET /api/5sim/countries

Returns countries currently available from 5SIM.

This is used by the Admin Add Service flow.

5SIM documents this as:
GET /v1/guest/countries

=========================================================
*/

app.get(
    "/api/5sim/countries",
    async (req, res) => {

        try {

            const now =
                Date.now();

            if(
                fiveSimCache.countries.data &&
                fiveSimCache.countries.expiresAt >
                    now
            ){

                return res.status(200).json({

                    success: true,

                    source:
                        "5sim",

                    cached:
                        true,

                    countries:
                        fiveSimCache
                            .countries
                            .data

                });

            }

            const rawCountries =
                await fetch5SimGuest(
                    "/guest/countries"
                );

            const countries =
                Object.entries(
                    rawCountries || {}
                )
                .map(
                    ([code, data]) => ({

                        code,

                        name:
                            data?.text_en ||
                            code,

                        iso:
                            data?.iso
                                ? Object.keys(
                                    data.iso
                                )[0]
                                : null,

                        prefix:
                            data?.prefix
                                ? Object.keys(
                                    data.prefix
                                )[0]
                                : null

                    })
                )
                .sort(
                    (a, b) =>
                        a.name.localeCompare(
                            b.name
                        )
                );

            fiveSimCache.countries = {

                data:
                    countries,

                expiresAt:
                    now +
                    FIVESIM_COUNTRIES_CACHE_MS

            };

            return res.status(200).json({

                success: true,

                source:
                    "5sim",

                cached:
                    false,

                countries

            });

        }
        catch(error){

            console.error(
                "5SIM countries error:",
                error
            );

            return res.status(502).json({

                success: false,

                message:
                    error.message ||
                    "Unable to load 5SIM countries."

            });

        }

    }
);


/*
=========================================================
5SIM — SERVICES FOR COUNTRY
=========================================================

GET /api/5sim/services?country=usa

Returns activation services currently available for the
selected country.

5SIM documents the upstream request as:
GET /v1/guest/products/{country}/{operator}

We use operator=any and keep only activation products.

=========================================================
*/

app.get(
    "/api/5sim/services",
    async (req, res) => {

        try {

            const country =
                validate5SimName(
                    req.query.country,
                    "country"
                );

            const now =
                Date.now();

            const cached =
                fiveSimCache
                    .services
                    .get(country);

            if(
                cached &&
                cached.expiresAt >
                    now
            ){

                return res.status(200).json({

                    success: true,

                    source:
                        "5sim",

                    cached:
                        true,

                    country,

                    services:
                        cached.data

                });

            }

            const rawProducts =
                await fetch5SimGuest(
                    `/guest/products/${encodeURIComponent(country)}/any`
                );

            const services =
                Object.entries(
                    rawProducts || {}
                )
                .filter(
                    ([serviceCode, data]) => {

                        return (
                            data?.Category ===
                            "activation"
                        );

                    }
                )
                .map(
                    ([serviceCode, data]) => ({

                        code:
                            serviceCode,

                        name:
                            serviceCode,

                        category:
                            data?.Category ||
                            "activation",

                        providerCost:
                            Number(
                                data?.Price || 0
                            ),

                        availableQuantity:
                            Number(
                                data?.Qty || 0
                            ),

                        available:
                            Number(
                                data?.Qty || 0
                            ) > 0

                    })
                )
                .sort(
                    (a, b) =>
                        a.name.localeCompare(
                            b.name
                        )
                );

            fiveSimCache
                .services
                .set(
                    country,
                    {

                        data:
                            services,

                        expiresAt:
                            now +
                            FIVESIM_SERVICES_CACHE_MS

                    }
                );

            return res.status(200).json({

                success: true,

                source:
                    "5sim",

                cached:
                    false,

                country,

                services

            });

        }
        catch(error){

            console.error(
                "5SIM services error:",
                error
            );

            return res.status(502).json({

                success: false,

                message:
                    error.message ||
                    "Unable to load 5SIM services."

            });

        }

    }
);


/*
=========================================================
5SIM — EXACT COUNTRY + SERVICE PRICE
=========================================================

GET /api/5sim/price?country=usa&service=whatsapp

Returns current operator-level prices, stock and delivery
rate for the selected country/service.

The backend selects the cheapest currently available operator
with a delivery/success rate of at least 70%. If costs tie, it
prefers the higher delivery rate and then higher stock. Operators
below 70% are never selected.

This provider information is for the Admin side only.
Customers will later receive the Numora price from
Firestore, not the 5SIM provider cost.

5SIM documents this as:
GET /v1/guest/prices?country={country}&product={product}

=========================================================
*/

app.get(
    "/api/5sim/price",
    async (req, res) => {

        try {

            const country =
                validate5SimName(
                    req.query.country,
                    "country"
                );

            const service =
                validate5SimName(
                    req.query.service,
                    "service"
                );

            const cacheKey =
                `${country}:${service}`;

            const now =
                Date.now();

            const cached =
                fiveSimCache
                    .prices
                    .get(cacheKey);

            if(
                cached &&
                cached.expiresAt >
                    now
            ){

                return res.status(200).json({

                    success: true,

                    source:
                        "5sim",

                    cached:
                        true,

                    ...cached.data

                });

            }

            const rawPrices =
                await fetch5SimGuest(
                    `/guest/prices?country=${encodeURIComponent(country)}&product=${encodeURIComponent(service)}`
                );

            const countryData =
                rawPrices?.[country] ||
                {};

            const serviceData =
                countryData?.[service] ||
                {};

            const operators =
                Object.entries(
                    serviceData
                )
                .map(
                    ([operator, data]) => ({

                        operator,

                        cost:
                            Number(
                                data?.cost || 0
                            ),

                        count:
                            Number(
                                data?.count || 0
                            ),

                        rate:
                            normalize5SimDeliveryRate(
                                data?.rate
                            )

                    })
                );

            const availableOperators =
                operators
                    .filter(
                        operator =>
                            operator.count >
                            0
                    )
                    .sort(
                        (a, b) => {

                            if(
                                a.cost !==
                                b.cost
                            ){

                                return (
                                    a.cost -
                                    b.cost
                                );

                            }

                            const aRate =
                                a.rate === null
                                    ? -1
                                    : a.rate;

                            const bRate =
                                b.rate === null
                                    ? -1
                                    : b.rate;

                            if(
                                aRate !==
                                bRate
                            ){

                                return (
                                    bRate -
                                    aRate
                                );

                            }

                            return (
                                b.count -
                                a.count
                            );

                        }
                    );

            const recommended =
                availableOperators[0] ||
                null;

            const result = {

                country,

                service,

                available:
                    Boolean(
                        recommended
                    ),

                providerCost:
                    recommended
                        ? recommended.cost
                        : null,

                providerCurrency:
                    "USD",

                availableQuantity:
                    recommended
                        ? recommended.count
                        : 0,

                deliveryRate:
                    recommended
                        ? recommended.rate
                        : null,

                recommendedOperator:
                    recommended
                        ? recommended.operator
                        : null,

                operators

            };

            fiveSimCache
                .prices
                .set(
                    cacheKey,
                    {

                        data:
                            result,

                        expiresAt:
                            now +
                            FIVESIM_PRICES_CACHE_MS

                    }
                );

            return res.status(200).json({

                success: true,

                source:
                    "5sim",

                cached:
                    false,

                ...result

            });

        }
        catch(error){

            console.error(
                "5SIM price error:",
                error
            );

            return res.status(502).json({

                success: false,

                message:
                    error.message ||
                    "Unable to load current 5SIM price."

            });

        }

    }
);


/*
=========================================================
SERVICE PRICING HELPERS
=========================================================

Admin controls whether a service is offered with:
- enabled
- price
- status

The `available` field is ONLY the latest 5SIM supplier
availability snapshot. It must NOT hide a service from the
customer catalog because supplier stock can temporarily
change. The purchase endpoint performs a fresh 5SIM check.
=========================================================
*/

function normalizePricingValue(value){

    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "");

}

function getPricingCountry(pricing){

    return normalizePricingValue(
        pricing.countryCode ||
        pricing.country ||
        pricing.countryId ||
        ""
    );

}

function getPricingService(pricing){

    return normalizePricingValue(
        pricing.serviceCode ||
        pricing.service ||
        pricing.serviceId ||
        ""
    );

}

function getPricingName(pricing){

    return (
        pricing.serviceName ||
        pricing.name ||
        pricing.service ||
        pricing.serviceCode ||
        ""
    );

}

function getPricingCountryName(pricing){

    return (
        pricing.countryName ||
        pricing.countryDisplayName ||
        pricing.country ||
        pricing.countryCode ||
        ""
    );

}

function getPricingPrice(pricing){

    const values = [
        pricing.price,
        pricing.numoraPrice,
        pricing.customerPrice,
        pricing.nairaPrice
    ];

    for(const value of values){

        const number = Number(value);

        if(Number.isFinite(number)){
            return number;
        }

    }

    return NaN;

}

function isPricingEnabled(pricing){

    if(pricing.enabled === false){
        return false;
    }

    const status =
        String(pricing.status || "")
            .trim()
            .toLowerCase();

    if(
        status === "inactive" ||
        status === "disabled"
    ){
        return false;
    }

    return true;

}

async function findServicePricing({
    pricingId,
    countryId,
    serviceId
}){

    if(!db){
        return null;
    }

    if(pricingId){

        const directRef =
            db.collection("servicePricing")
                .doc(String(pricingId).trim());

        const directSnapshot =
            await directRef.get();

        if(directSnapshot.exists){

            const data =
                directSnapshot.data() || {};

            const country =
                getPricingCountry(data);

            const service =
                getPricingService(data);

            const requestedCountry =
                normalizePricingValue(countryId);

            const requestedService =
                normalizePricingValue(serviceId);

            if(
                (!requestedCountry || country === requestedCountry) &&
                (!requestedService || service === requestedService)
            ){

                return {
                    ref: directRef,
                    id: directSnapshot.id,
                    data
                };

            }

        }

    }

    const requestedCountry =
        normalizePricingValue(countryId);

    const requestedService =
        normalizePricingValue(serviceId);

    if(!requestedCountry || !requestedService){
        return null;
    }

    const snapshot =
        await db.collection("servicePricing").get();

    for(const document of snapshot.docs){

        const data =
            document.data() || {};

        if(
            getPricingCountry(data) === requestedCountry &&
            getPricingService(data) === requestedService
        ){

            return {
                ref: document.ref,
                id: document.id,
                data
            };

        }

    }

    return null;

}


/*
=========================================================
CUSTOMER — SERVICE CATALOG
=========================================================

GET /api/customer/catalog

This endpoint reads the Admin-controlled servicePricing
catalog. It does NOT use Firestore directly from the
customer browser.

Important:
`available` is supplier availability from 5SIM and does
NOT decide whether the catalog item is visible. The live
5SIM purchase check happens when the customer buys.
=========================================================
*/

app.get(
    "/api/customer/catalog",
    async (req, res) => {

        try{

            if(!db){

                return res.status(500).json({
                    success:false,
                    message:"Firestore is unavailable."
                });

            }

            const snapshot =
                await db
                    .collection("servicePricing")
                    .get();

            const services = [];

            snapshot.forEach(document => {

                const pricing =
                    document.data() || {};

                if(!isPricingEnabled(pricing)){
                    return;
                }

                const country =
                    getPricingCountry(pricing);

                const service =
                    getPricingService(pricing);

                const price =
                    getPricingPrice(pricing);

                if(
                    !country ||
                    !service ||
                    !Number.isFinite(price) ||
                    price <= 0
                ){
                    return;
                }

                services.push({

                    id:
                        document.id,

                    pricingId:
                        document.id,

                    country,

                    countryId:
                        country,

                    countryName:
                        getPricingCountryName(pricing),

                    service,

                    serviceId:
                        service,

                    serviceName:
                        getPricingName(pricing),

                    price,

                    currency:
                        "NGN",

                    providerAvailable:
                        pricing.available !== false

                });

            });

            services.sort((a,b) => {

                const countryCompare =
                    String(a.countryName || a.country)
                        .localeCompare(
                            String(b.countryName || b.country)
                        );

                if(countryCompare !== 0){
                    return countryCompare;
                }

                return String(a.serviceName || a.service)
                    .localeCompare(
                        String(b.serviceName || b.service)
                    );

            });

            return res.status(200).json({
                success:true,
                services
            });

        }
        catch(error){

            console.error(
                "Customer catalog error:",
                error
            );

            return res.status(500).json({
                success:false,
                message:"Unable to load Numora services."
            });

        }

    }
);


/*
=========================================================
CUSTOMER — PURCHASE 5SIM NUMBER
=========================================================

POST /api/customer/purchase-number

Body:
{
    countryId: "usa",
    serviceId: "whatsapp"
}

The customer never supplies or sees a 5SIM operator.
Numora re-checks live 5SIM inventory and chooses the
cheapest operator whose delivery rate is at least 70%.

The Numora price is read from servicePricing on the
server, so the browser cannot change the purchase price.
=========================================================
*/

app.post(
    "/api/customer/purchase-number",
    async (req, res) => {

        let orderRef = null;
        let userRef = null;
        let balanceField = "balance";
        let reservedAmount = 0;
        let fiveSimPurchaseSucceeded = false;

        try {

            if(!db){

                return res.status(500).json({

                    success: false,

                    message:
                        "Firestore is unavailable."

                });

            }

            if(!get5SimApiKey()){

                return res.status(500).json({

                    success: false,

                    message:
                        "5SIM is not configured on the Numora backend."

                });

            }

            const decodedToken =
                await authenticateCustomerRequest(
                    req
                );

            const uid =
                decodedToken.uid;

            const country =
                validate5SimName(
                    req.body?.countryId,
                    "country"
                );

            const service =
                validate5SimName(
                    req.body?.serviceId,
                    "service"
                );

            const requestedPricingId =
                String(
                    req.body?.pricingId ||
                    ""
                ).trim();

            const pricingResult =
                await findServicePricing({
                    pricingId:
                        requestedPricingId || null,
                    countryId:
                        country,
                    serviceId:
                        service
                });

            if(!pricingResult){

                return res.status(404).json({

                    success: false,

                    message:
                        "This country and service is not available on Numora."

                });

            }

            const pricingRef =
                pricingResult.ref;

            const pricing =
                pricingResult.data ||
                {};

            const numoraPrice =
                Math.round(
                    Number(
                        pricing.price || 0
                    )
                );

            if(
                pricing.enabled === false ||
                !Number.isFinite(numoraPrice) ||
                numoraPrice <= 0
            ){

                return res.status(400).json({

                    success: false,

                    message:
                        "This service is not currently available for purchase."

                });

            }

            userRef =
                db.collection(
                    "users"
                ).doc(
                    uid
                );

            const userSnapshot =
                await userRef.get();

            if(!userSnapshot.exists){

                return res.status(404).json({

                    success: false,

                    message:
                        "Your Numora customer profile was not found."

                });

            }

            const userData =
                userSnapshot.data() ||
                {};

            balanceField =
                getCustomerBalanceField(
                    userData
                );

            const currentBalance =
                getCustomerBalance(
                    userData,
                    balanceField
                );

            if(currentBalance < numoraPrice){

                return res.status(400).json({

                    success: false,

                    code:
                        "INSUFFICIENT_BALANCE",

                    balance:
                        currentBalance,

                    price:
                        numoraPrice,

                    message:
                        "Your Naira balance is too low for this purchase."

                });

            }

            orderRef =
                db.collection(
                    "orders"
                ).doc();

            reservedAmount =
                numoraPrice;

            /*
              Reserve the customer's Numora price before contacting 5SIM.
              Firestore transaction prevents two simultaneous purchases
              from spending the same balance.
            */
            await db.runTransaction(
                async transaction => {

                    const freshUserSnapshot =
                        await transaction.get(
                            userRef
                        );

                    if(!freshUserSnapshot.exists){

                        throw new Error(
                            "Your Numora customer profile was not found."
                        );

                    }

                    const freshUserData =
                        freshUserSnapshot.data() ||
                        {};

                    const freshField =
                        getCustomerBalanceField(
                            freshUserData
                        );

                    if(freshField !== balanceField){

                        throw new Error(
                            "Your balance changed structure. Please try again."
                        );

                    }

                    const freshBalance =
                        getCustomerBalance(
                            freshUserData,
                            freshField
                        );

                    if(freshBalance < numoraPrice){

                        const error =
                            new Error(
                                "Your Naira balance is too low for this purchase."
                            );

                        error.status = 400;
                        error.code =
                            "INSUFFICIENT_BALANCE";

                        throw error;

                    }

                    transaction.update(
                        userRef,
                        {

                            [balanceField]:
                                admin.firestore.FieldValue
                                    .increment(
                                        -numoraPrice
                                    )

                        }
                    );

                    transaction.set(
                        orderRef,
                        {

                            customerId:
                                uid,

                            profileId:
                                userData.profileId ||
                                null,

                            customerEmail:
                                decodedToken.email ||
                                userData.email ||
                                null,

                            country:
                                country,

                            countryCode:
                                pricing.countryCode ||
                                country,

                            countryName:
                                pricing.country ||
                                country.toUpperCase(),

                            service:
                                pricing.serviceCode ||
                                service,

                            serviceCode:
                                pricing.serviceCode ||
                                service,

                            serviceName:
                                pricing.service ||
                                service,

                            price:
                                numoraPrice,

                            priceNaira:
                                numoraPrice,

                            currency:
                                "NGN",

                            balanceField:
                                balanceField,

                            balanceReservation:
                                "Reserved",

                            provider:
                                "5SIM",

                            purchaseStatus:
                                "Purchasing",

                            status:
                                "Purchasing",

                            phoneNumber:
                                null,

                            fiveSimOrderId:
                                null,

                            createdAt:
                                serverTimestamp(),

                            updatedAt:
                                serverTimestamp()

                        }
                    );

                }
            );

            /*
              5SIM availability and operator price are checked again at
              the exact moment of purchase. We never rely on the cached
              Admin value for the transaction.
            */
            const providerSelection =
                await get5SimPurchaseOption(
                    country,
                    service
                );

            const selectedOperator =
                providerSelection.selected;

            if(!selectedOperator){

                await refundCustomerReservation(
                    userRef,
                    balanceField,
                    reservedAmount,
                    orderRef,
                    "No 5SIM operator with at least 70% delivery rate and available stock was found."
                );

                return res.status(409).json({

                    success: false,

                    code:
                        "NO_QUALIFYING_PROVIDER",

                    message:
                        "No suitable 5SIM number is available right now. Your Numora balance was not charged."

                });

            }

            await orderRef.update({

                providerOperator:
                    selectedOperator.operator,

                providerCostUsd:
                    selectedOperator.cost,

                providerDeliveryRate:
                    selectedOperator.rate,

                providerStockAtPurchase:
                    selectedOperator.count,

                purchaseStatus:
                    "Sending to 5SIM",

                updatedAt:
                    serverTimestamp()

            });

            let fiveSimResponse;

            try{

                fiveSimResponse =
                    await buy5SimActivation(
                        country,
                        selectedOperator.operator,
                        service
                    );

            }
            catch(error){

                const refunded =
                    await refundCustomerReservation(
                        userRef,
                        balanceField,
                        reservedAmount,
                        orderRef,
                        error.message ||
                        "5SIM rejected the number purchase."
                    );

                return res.status(502).json({

                    success: false,

                    code:
                        "FIVESIM_PURCHASE_FAILED",

                    refunded,

                    message:
                        refunded
                            ? "5SIM could not provide a number. Your Numora balance was refunded."
                            : "5SIM could not provide a number and the balance refund is pending."

                });

            }

            const purchase =
                normalize5SimPurchaseResponse(
                    fiveSimResponse
                );

            /*
              Once 5SIM has returned a real order ID, the provider
              purchase has happened. From this point onward we must
              never refund the customer's Numora balance automatically
              merely because Firestore persistence encounters an error.
            */
            if(purchase.orderId){
                fiveSimPurchaseSucceeded = true;
            }

            if(
                !purchase.orderId ||
                !purchase.phoneNumber
            ){

                const refunded =
                    await refundCustomerReservation(
                        userRef,
                        balanceField,
                        reservedAmount,
                        orderRef,
                        "5SIM returned an incomplete purchase response."
                    );

                return res.status(502).json({

                    success: false,

                    code:
                        "INVALID_FIVESIM_RESPONSE",

                    refunded,

                    message:
                        refunded
                            ? "5SIM returned an invalid number response. Your Numora balance was refunded."
                            : "5SIM returned an invalid number response and the balance refund is pending."

                });

            }

            const completedAt =
                admin.firestore.Timestamp.now();

            /*
              Store both the customer order and a simple numbers record.
              This gives the Admin dashboard a usable active-number record
              while the customer page can later use the order record.
            */
            await orderRef.update({

                purchaseStatus:
                    "Active",

                status:
                    "Active",

                balanceReservation:
                    "Captured",

                fiveSimOrderId:
                    purchase.orderId,

                fiveSimStatus:
                    purchase.status ||
                    "PENDING",

                phoneNumber:
                    purchase.phoneNumber,

                providerOperator:
                    selectedOperator.operator,

                providerCostUsd:
                    selectedOperator.cost,

                providerDeliveryRate:
                    selectedOperator.rate,

                activatedAt:
                    completedAt,

                purchasedAt:
                    completedAt,

                updatedAt:
                    completedAt

            });

            try{

                await db
                    .collection("numbers")
                    .doc(orderRef.id)
                    .set({

                        orderId:
                            orderRef.id,

                        customerId:
                            uid,

                        profileId:
                            userData.profileId ||
                            null,

                        phoneNumber:
                            purchase.phoneNumber,

                        country:
                            country,

                        service:
                            service,

                        serviceName:
                            pricing.service ||
                            service,

                        provider:
                            "5SIM",

                        fiveSimOrderId:
                            purchase.orderId,

                        operator:
                            selectedOperator.operator,

                        priceNaira:
                            numoraPrice,

                        providerCostUsd:
                            selectedOperator.cost,

                        deliveryRate:
                            selectedOperator.rate,

                        active:
                            true,

                        status:
                            "Active",

                        createdAt:
                            completedAt,

                        updatedAt:
                            completedAt

                    },
                    {
                        merge:true
                    }
                );

            }
            catch(numberRecordError){

                console.error(
                    "5SIM purchase succeeded but numbers record could not be saved:",
                    numberRecordError
                );
            }

            return res.status(200).json({

                success: true,

                active:
                    true,

                orderId:
                    orderRef.id,

                fiveSimOrderId:
                    purchase.orderId,

                phoneNumber:
                    purchase.phoneNumber,

                country:
                    country,

                service:
                    service,

                price:
                    numoraPrice,

                currency:
                    "NGN",

                status:
                    purchase.status ||
                    "PENDING_SMS",

                message:
                    "Your number is ready. Use it for the verification step and wait for the SMS."

            });

        }
        catch(error){

            console.error(
                "Customer 5SIM purchase error:",
                error
            );

            /*
              If the balance was reserved but the request failed before
              a successful 5SIM order was recorded, attempt a refund.
              Do not automatically refund after a successful 5SIM purchase.
            */
            if(
                orderRef &&
                userRef &&
                reservedAmount > 0
            ){

                try{

                    const orderSnapshot =
                        await orderRef.get();

                    const orderData =
                        orderSnapshot.exists
                            ? orderSnapshot.data()
                            : {};

                    if(
                        !fiveSimPurchaseSucceeded &&
                        orderData.balanceReservation ===
                        "Reserved"
                    ){

                        await refundCustomerReservation(
                            userRef,
                            balanceField,
                            reservedAmount,
                            orderRef,
                            error.message ||
                            "Unexpected purchase error."
                        );

                    }

                }
                catch(refundError){

                    console.error(
                        "Unexpected purchase refund error:",
                        refundError
                    );

                }

            }

            const statusCode =
                Number(error.status) ||
                (
                    error.code ===
                    "INSUFFICIENT_BALANCE"
                        ? 400
                        : 500
                );

            return res.status(statusCode).json({

                success: false,

                code:
                    error.code ||
                    "PURCHASE_FAILED",

                message:
                    error.message ||
                    "Unable to purchase a Numora number."

            });

        }

    }
);


/*
=========================================================
CUSTOMER — CHECK 5SIM ORDER / SMS
=========================================================

GET /api/customer/5sim-order/:orderId

This keeps the 5SIM API key private and lets the customer
page poll the activation through Numora.
=========================================================
*/

app.get(
    "/api/customer/5sim-order/:orderId",
    async (req, res) => {

        try{

            if(!db){

                return res.status(500).json({

                    success:false,

                    message:
                        "Firestore is unavailable."

                });

            }

            if(!get5SimApiKey()){

                return res.status(500).json({

                    success:false,

                    message:
                        "5SIM is not configured on the Numora backend."

                });

            }

            const decodedToken =
                await authenticateCustomerRequest(
                    req
                );

            const orderId =
                String(
                    req.params.orderId || ""
                ).trim();

            if(!orderId){

                return res.status(400).json({

                    success:false,

                    message:
                        "Order ID is required."

                });

            }

            const orderRef =
                db.collection("orders").doc(orderId);

            const orderSnapshot =
                await orderRef.get();

            if(!orderSnapshot.exists){

                return res.status(404).json({

                    success:false,

                    message:
                        "Numora order not found."

                });

            }

            const order =
                orderSnapshot.data() ||
                {};

            if(
                order.customerId !==
                decodedToken.uid
            ){

                return res.status(403).json({

                    success:false,

                    message:
                        "You are not allowed to access this order."

                });

            }

            if(!order.fiveSimOrderId){

                return res.status(409).json({

                    success:false,

                    message:
                        "This order does not have a 5SIM activation yet."

                });

            }

            const fiveSimData =
                await fetch5SimAuthenticated(
                    `/user/check/${encodeURIComponent(order.fiveSimOrderId)}`,
                    {
                        method:"GET"
                    }
                );

            const sms =
                Array.isArray(fiveSimData?.sms)
                    ? fiveSimData.sms
                    : [];

            const status =
                fiveSimData?.status ||
                order.fiveSimStatus ||
                "PENDING";

            await orderRef.update({

                fiveSimStatus:
                    status,

                lastSms:
                    sms.length
                        ? sms[sms.length - 1]
                        : null,

                smsCount:
                    sms.length,

                lastCheckedAt:
                    serverTimestamp(),

                updatedAt:
                    serverTimestamp()

            });

            return res.status(200).json({

                success:true,

                orderId,

                fiveSimOrderId:
                    order.fiveSimOrderId,

                phoneNumber:
                    fiveSimData?.phone ||
                    order.phoneNumber ||
                    null,

                status,

                sms,

                price:
                    order.priceNaira ||
                    order.price ||
                    0,

                currency:
                    "NGN"

            });

        }
        catch(error){

            console.error(
                "5SIM order check error:",
                error
            );

            const statusCode =
                Number(error.status) ||
                500;

            return res.status(statusCode).json({

                success:false,

                message:
                    error.message ||
                    "Unable to check the 5SIM order."

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

    const currentSnapshot =
        await orderRef.get();

    if(!currentSnapshot.exists){

        throw new Error(
            "Order no longer exists."
        );

    }

    const currentOrder =
        currentSnapshot.data();

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

        console.log(
            "5SIM integration:",
            get5SimApiKey()
                ? "API key configured"
                : "API key not configured"
        );

    }
);
