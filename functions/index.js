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
*/

const FIVESIM_API_BASE =
    "https://5sim.net/v1";

const FIVESIM_REQUEST_TIMEOUT =
    10000;

const FIVESIM_MIN_DELIVERY_RATE =
    70;

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
=========================================================
5SIM CACHE
=========================================================
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
CUSTOMER AUTHENTICATION
=========================================================

The customer dashboard sends:

Authorization:
Bearer FIREBASE_ID_TOKEN

The backend verifies the token using Firebase Admin.

The Firebase UID is NEVER trusted from the request body.
=========================================================
*/

async function authenticateCustomer(
    req
){

    if(!firebaseInitialized){

        const error =
            new Error(
                "Firebase authentication is unavailable."
            );

        error.status =
            500;

        throw error;

    }

    const authorization =
        req.headers.authorization || "";

    if(
        !authorization.startsWith(
            "Bearer "
        )
    ){

        const error =
            new Error(
                "Authentication required."
            );

        error.status =
            401;

        throw error;

    }

    const idToken =
        authorization
            .substring(7)
            .trim();

    if(!idToken){

        const error =
            new Error(
                "Authentication token is missing."
            );

        error.status =
            401;

        throw error;

    }

    try {

        return await admin
            .auth()
            .verifyIdToken(
                idToken
            );

    }
    catch(error){

        const authError =
            new Error(
                "Invalid or expired authentication token."
            );

        authError.status =
            401;

        throw authError;

    }

}


/*
=========================================================
SERVICE PRICING HELPERS
=========================================================
*/

function getPricingCountry(
    pricing
){

    return normalize5SimValue(
        pricing.countryCode ||
        pricing.country ||
        pricing.countryId ||
        ""
    );

}


function getPricingService(
    pricing
){

    return normalize5SimValue(
        pricing.serviceCode ||
        pricing.service ||
        pricing.serviceId ||
        ""
    );

}


function getPricingName(
    pricing
){

    return (
        pricing.serviceName ||
        pricing.name ||
        pricing.service ||
        pricing.serviceCode ||
        ""
    );

}


function getPricingCountryName(
    pricing
){

    return (
        pricing.countryName ||
        pricing.countryDisplayName ||
        pricing.country ||
        pricing.countryCode ||
        ""
    );

}


function getPricingPrice(
    pricing
){

    const possibleValues = [

        pricing.price,

        pricing.numoraPrice,

        pricing.customerPrice,

        pricing.nairaPrice

    ];

    for(
        const value of possibleValues
    ){

        const number =
            Number(value);

        if(
            Number.isFinite(number)
        ){

            return number;

        }

    }

    return NaN;

}


/*
---------------------------------------------------------
FIND SERVICE PRICING
---------------------------------------------------------

The admin can store the service document using slightly
different field names depending on the version of the
Admin dashboard.

The backend normalizes those fields here.

The customer price is ALWAYS taken from Firestore.

The customer cannot submit the price.

---------------------------------------------------------
*/

async function findServicePricing(
    {
        pricingId,
        country,
        service
    }
){

    if(!db){

        throw new Error(
            "Firestore is unavailable."
        );

    }

    const normalizedCountry =
        normalize5SimValue(
            country
        );

    const normalizedService =
        normalize5SimValue(
            service
        );

    if(
        pricingId
    ){

        const directRef =
            db
                .collection("servicePricing")
                .doc(
                    String(
                        pricingId
                    )
                );

        const directSnapshot =
            await directRef.get();

        if(
            directSnapshot.exists
        ){

            const data =
                directSnapshot.data();

            const directCountry =
                getPricingCountry(
                    data
                );

            const directService =
                getPricingService(
                    data
                );

            if(
                (
                    !normalizedCountry ||
                    directCountry ===
                    normalizedCountry
                )
                &&
                (
                    !normalizedService ||
                    directService ===
                    normalizedService
                )
            ){

                return {

                    ref:
                        directRef,

                    id:
                        directSnapshot.id,

                    data

                };

            }

        }

    }

    const snapshot =
        await db
            .collection("servicePricing")
            .get();

    let match =
        null;

    snapshot.forEach(
        document => {

            if(match){

                return;

            }

            const data =
                document.data();

            const documentCountry =
                getPricingCountry(
                    data
                );

            const documentService =
                getPricingService(
                    data
                );

            if(
                documentCountry ===
                normalizedCountry
                &&
                documentService ===
                normalizedService
            ){

                match = {

                    ref:
                        document.ref,

                    id:
                        document.id,

                    data

                };

            }

        }
    );

    return match;

}


/*
---------------------------------------------------------
CHECK WHETHER SERVICE PRICING IS AVAILABLE
---------------------------------------------------------
*/

function isPricingAvailable(
    pricing
){

    if(
        pricing.available === false
    ){

        return false;

    }

    if(
        pricing.enabled === false
    ){

        return false;

    }

    if(
        String(
            pricing.status ||
            ""
        ).toLowerCase()
        ===
        "inactive"
    ){

        return false;

    }

    if(
        String(
            pricing.status ||
            ""
        ).toLowerCase()
        ===
        "disabled"
    ){

        return false;

    }

    return true;

}


/*
=========================================================
5SIM OPERATOR PRICE LOADER
=========================================================
*/

async function load5SimOperators(
    country,
    service
){

    const normalizedCountry =
        validate5SimName(
            country,
            "country"
        );

    const normalizedService =
        validate5SimName(
            service,
            "service"
        );

    const cacheKey =
        `${normalizedCountry}:${normalizedService}`;

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

        return cached.data;

    }

    const rawPrices =
        await fetch5SimGuest(
            `/guest/prices?country=${encodeURIComponent(normalizedCountry)}&product=${encodeURIComponent(normalizedService)}`
        );

    const countryData =
        rawPrices?.[normalizedCountry] ||
        {};

    const serviceData =
        countryData?.[normalizedService] ||
        {};

    const operators =
        Object.entries(
            serviceData
        )
        .map(
            ([operator, data]) => {

                const rateValue =
                    data?.rate !== undefined
                        ? data.rate
                        : data?.rate_percents;

                const parsedRate =
                    rateValue !== undefined &&
                    rateValue !== null &&
                    rateValue !== ""
                        ? Number(
                            rateValue
                        )
                        : null;

                return {

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
                        Number.isFinite(
                            parsedRate
                        )
                            ? parsedRate
                            : null

                };

            }
        );

    const result = {

        country:
            normalizedCountry,

        service:
            normalizedService,

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

    return result;

}


/*
---------------------------------------------------------
SELECT QUALIFYING 5SIM OPERATOR
---------------------------------------------------------

RULE:

1. Stock must be greater than 0.
2. Delivery rate must be at least 70%.
3. Among qualifying operators, choose the cheapest.
4. If price ties, choose the higher delivery rate.
5. If still tied, choose the higher stock.

There is NO lower-quality fallback.

---------------------------------------------------------
*/

function select5SimOperator(
    operators
){

    const qualifyingOperators =
        operators
            .filter(
                operator => {

                    return (
                        operator.count >
                        0
                        &&
                        operator.rate !== null
                        &&
                        operator.rate >=
                        FIVESIM_MIN_DELIVERY_RATE
                    );

                }
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

    return (
        qualifyingOperators[0] ||
        null
    );

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

ADMIN/INTERNAL VIEW

The recommended operator now MUST have:

- stock > 0
- delivery rate >= 70%

Then cheapest qualifying operator wins.

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

            const priceData =
                await load5SimOperators(
                    country,
                    service
                );

            const recommended =
                select5SimOperator(
                    priceData.operators
                );

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

                minimumDeliveryRate:
                    FIVESIM_MIN_DELIVERY_RATE,

                operators:
                    priceData.operators

            };

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
CUSTOMER — GET SERVICE CATALOG
=========================================================

The customer does NOT use the 5SIM catalog directly.

Only services that the Admin has added to Firestore
servicePricing are returned.

The provider cost is deliberately NOT returned.

=========================================================
*/

app.get(
    "/api/customer/catalog",
    async (req, res) => {

        try {

            if(!db){

                return res.status(500).json({

                    success: false,

                    message:
                        "Firestore is unavailable."

                });

            }

            const snapshot =
                await db
                    .collection("servicePricing")
                    .get();

            const services = [];

            snapshot.forEach(
                document => {

                    const pricing =
                        document.data();

                    if(
                        !isPricingAvailable(
                            pricing
                        )
                    ){

                        return;

                    }

                    const countryCode =
                        getPricingCountry(
                            pricing
                        );

                    const serviceCode =
                        getPricingService(
                            pricing
                        );

                    const price =
                        getPricingPrice(
                            pricing
                        );

                    if(
                        !countryCode ||
                        !serviceCode ||
                        !Number.isFinite(price) ||
                        price <= 0
                    ){

                        return;

                    }

                    services.push({

                        id:
                            document.id,

                        country:
                            countryCode,

                        countryName:
                            getPricingCountryName(
                                pricing
                            ),

                        service:
                            serviceCode,

                        serviceName:
                            getPricingName(
                                pricing
                            ),

                        price

                    });

                }
            );

            services.sort(
                (a, b) => {

                    const countryCompare =
                        a.countryName.localeCompare(
                            b.countryName
                        );

                    if(
                        countryCompare !== 0
                    ){

                        return countryCompare;

                    }

                    return a.serviceName.localeCompare(
                        b.serviceName
                    );

                }
            );

            return res.status(200).json({

                success: true,

                services

            });

        }
        catch(error){

            console.error(
                "Customer catalog error:",
                error
            );

            return res.status(500).json({

                success: false,

                message:
                    "Unable to load Numora services."

            });

        }

    }
);


/*
=========================================================
CUSTOMER — PURCHASE NUMBER
=========================================================

POST /api/customer/purchase-number

Body:

{
    pricingId,
    countryId,
    serviceId,
    requestId
}

IMPORTANT:

The customer price is loaded from Firestore.

The browser cannot choose the price.

5SIM provider cost is not exposed.

=========================================================
*/

app.post(
    "/api/customer/purchase-number",
    async (req, res) => {

        let purchaseRef = null;
        let uid = null;
        let reservedAmount = 0;
        let balanceField = "balance";

        try {

            const decodedToken =
                await authenticateCustomer(
                    req
                );

            uid =
                decodedToken.uid;

            if(!db){

                return res.status(500).json({

                    success: false,

                    message:
                        "Firestore is unavailable."

                });

            }

            const {

                pricingId,
                countryId,
                serviceId,
                requestId

            } = req.body || {};

            const country =
                normalize5SimValue(
                    countryId
                );

            const service =
                normalize5SimValue(
                    serviceId
                );

            if(
                !country ||
                !service
            ){

                return res.status(400).json({

                    success: false,

                    message:
                        "Country and service are required."

                });

            }

            /*
            -------------------------------------------------
            FIND ADMIN PRICING
            -------------------------------------------------
            */

            const pricingDocument =
                await findServicePricing({

                    pricingId,

                    country,

                    service

                });

            if(!pricingDocument){

                return res.status(404).json({

                    success: false,

                    message:
                        "This service is not currently available on Numora."

                });

            }

            const pricing =
                pricingDocument.data;

            if(
                !isPricingAvailable(
                    pricing
                )
            ){

                return res.status(409).json({

                    success: false,

                    message:
                        "This service is currently unavailable."

                });

            }

            const numoraPrice =
                getPricingPrice(
                    pricing
                );

            if(
                !Number.isFinite(
                    numoraPrice
                )
                ||
                numoraPrice <= 0
            ){

                return res.status(409).json({

                    success: false,

                    message:
                        "This service does not have a valid Numora price."

                });

            }

            /*
            -------------------------------------------------
            PURCHASE REQUEST ID
            -------------------------------------------------

            This prevents accidental double-click purchases
            when the customer sends the same request twice.
            -------------------------------------------------
            */

            let safeRequestId =
                String(
                    requestId ||
                    crypto.randomUUID()
                )
                    .trim()
                    .replace(
                        /[^a-zA-Z0-9_-]/g,
                        ""
                    )
                    .substring(
                        0,
                        100
                    );

            if(
                !safeRequestId
            ){

                safeRequestId =
                    crypto.randomUUID();
                
            }

            const purchaseId =
                `${uid}_${safeRequestId}`;

            purchaseRef =
                db
                    .collection("customerPurchases")
                    .doc(
                        purchaseId
                    );

            /*
            -------------------------------------------------
            RESERVE CUSTOMER BALANCE
            -------------------------------------------------
            */

            const reservationResult =
                await db.runTransaction(
                    async transaction => {

                        const purchaseSnapshot =
                            await transaction.get(
                                purchaseRef
                            );

                        if(
                            purchaseSnapshot.exists
                        ){

                            const existingPurchase =
                                purchaseSnapshot.data();

                            return {

                                alreadyExists:
                                    true,

                                purchase:
                                    existingPurchase

                            };

                        }

                        const userRef =
                            db
                                .collection("users")
                                .doc(
                                    uid
                                );

                        const userSnapshot =
                            await transaction.get(
                                userRef
                            );

                        if(
                            !userSnapshot.exists
                        ){

                            const error =
                                new Error(
                                    "Customer profile was not found."
                                );

                            error.status =
                                404;

                            throw error;

                        }

                        const userData =
                            userSnapshot.data();

                        if(
                            Number.isFinite(
                                Number(
                                    userData.balance
                                )
                            )
                        ){

                            balanceField =
                                "balance";

                        }
                        else if(
                            Number.isFinite(
                                Number(
                                    userData.nairaBalance
                                )
                            )
                        ){

                            balanceField =
                                "nairaBalance";

                        }
                        else if(
                            Number.isFinite(
                                Number(
                                    userData.walletBalance
                                )
                            )
                        ){

                            balanceField =
                                "walletBalance";

                        }
                        else {

                            balanceField =
                                "balance";

                        }

                        const currentBalance =
                            Number(
                                userData[
                                    balanceField
                                ] || 0
                            );

                        if(
                            currentBalance <
                            numoraPrice
                        ){

                            const error =
                                new Error(
                                    "Insufficient Naira balance."
                                );

                            error.status =
                                402;

                            error.currentBalance =
                                currentBalance;

                            throw error;

                        }

                        const newBalance =
                            Number(
                                (
                                    currentBalance -
                                    numoraPrice
                                ).toFixed(2)
                            );

                        reservedAmount =
                            numoraPrice;

                        transaction.update(
                            userRef,
                            {

                                [balanceField]:
                                    newBalance,

                                updatedAt:
                                    serverTimestamp()

                            }
                        );

                        transaction.set(
                            purchaseRef,
                            {

                                userId:
                                    uid,

                                profileId:
                                    userData.profileId ||
                                    null,

                                requestId:
                                    safeRequestId,

                                pricingId:
                                    pricingDocument.id,

                                country:
                                    country,

                                countryName:
                                    getPricingCountryName(
                                        pricing
                                    ),

                                service:
                                    service,

                                serviceName:
                                    getPricingName(
                                        pricing
                                    ),

                                numoraPrice:
                                    numoraPrice,

                                customerPrice:
                                    numoraPrice,

                                currency:
                                    "NGN",

                                status:
                                    "PURCHASING",

                                balanceField:
                                    balanceField,

                                balanceBefore:
                                    currentBalance,

                                balanceAfter:
                                    newBalance,

                                provider:
                                    "5SIM",

                                createdAt:
                                    serverTimestamp(),

                                updatedAt:
                                    serverTimestamp()

                            }
                        );

                        return {

                            alreadyExists:
                                false,

                            currentBalance,

                            newBalance

                        };

                    }
                );

            /*
            -------------------------------------------------
            HANDLE EXISTING REQUEST
            -------------------------------------------------
            */

            if(
                reservationResult.alreadyExists
            ){

                const existing =
                    reservationResult.purchase;

                if(
                    existing.status ===
                    "COMPLETED"
                ){

                    return res.status(200).json({

                        success: true,

                        alreadyPurchased:
                            true,

                        purchaseId:
                            purchaseId,

                        number:
                            existing.phoneNumber ||
                            null,

                        phoneNumber:
                            existing.phoneNumber ||
                            null,

                        service:
                            existing.service,

                        country:
                            existing.country,

                        price:
                            existing.numoraPrice,

                        status:
                            existing.status

                    });

                }

                if(
                    existing.status ===
                    "PURCHASING"
                ){

                    return res.status(409).json({

                        success: false,

                        processing:
                            true,

                        purchaseId:
                            purchaseId,

                        message:
                            "This purchase is already being processed."

                    });

                }

                if(
                    existing.status ===
                    "FAILED"
                    ||
                    existing.status ===
                    "REFUNDED"
                ){

                    await purchaseRef.delete();

                    return res.status(409).json({

                        success: false,

                        message:
                            "Please try the purchase again."

                    });

                }

            }

            /*
            -------------------------------------------------
            GET LIVE 5SIM OPERATOR DATA
            -------------------------------------------------
            */

            const priceData =
                await load5SimOperators(
                    country,
                    service
                );

            const selectedOperator =
                select5SimOperator(
                    priceData.operators
                );

            /*
            -------------------------------------------------
            NO QUALIFYING OPERATOR
            -------------------------------------------------
            */

            if(!selectedOperator){

                await db.runTransaction(
                    async transaction => {

                        const userRef =
                            db
                                .collection("users")
                                .doc(
                                    uid
                                );

                        const purchaseSnapshot =
                            await transaction.get(
                                purchaseRef
                            );

                        const userSnapshot =
                            await transaction.get(
                                userRef
                            );

                        if(
                            !purchaseSnapshot.exists ||
                            !userSnapshot.exists
                        ){

                            return;

                        }

                        const userData =
                            userSnapshot.data();

                        const currentBalance =
                            Number(
                                userData[
                                    balanceField
                                ] || 0
                            );

                        const refundedBalance =
                            Number(
                                (
                                    currentBalance +
                                    numoraPrice
                                ).toFixed(2)
                            );

                        transaction.update(
                            userRef,
                            {

                                [balanceField]:
                                    refundedBalance,

                                updatedAt:
                                    serverTimestamp()

                            }
                        );

                        transaction.update(
                            purchaseRef,
                            {

                                status:
                                    "REFUNDED",

                                refundReason:
                                    "No 5SIM operator met the 70% minimum delivery rate.",

                                refundedAmount:
                                    numoraPrice,

                                refundedAt:
                                    serverTimestamp(),

                                updatedAt:
                                    serverTimestamp()

                            }
                        );

                    }
                );

                return res.status(409).json({

                    success: false,

                    unavailable:
                        true,

                    refunded:
                        true,

                    message:
                        "No number is currently available with the required 70% or higher SMS delivery rate. Your balance was not charged."

                });

            }

            /*
            -------------------------------------------------
            SAVE SELECTED OPERATOR
            -------------------------------------------------
            */

            await purchaseRef.update({

                selectedOperator:
                    selectedOperator.operator,

                providerCost:
                    selectedOperator.cost,

                providerCurrency:
                    "USD",

                providerDeliveryRate:
                    selectedOperator.rate,

                providerStock:
                    selectedOperator.count,

                minimumDeliveryRate:
                    FIVESIM_MIN_DELIVERY_RATE,

                updatedAt:
                    serverTimestamp()

            });

            /*
            -------------------------------------------------
            BUY FROM 5SIM
            -------------------------------------------------
            */

            let fiveSimOrder;

            try {

                fiveSimOrder =
                    await fetch5SimAuthenticated(
                        `/user/buy/activation/${encodeURIComponent(country)}/${encodeURIComponent(selectedOperator.operator)}/${encodeURIComponent(service)}`
                    );

            }
            catch(error){

                console.error(
                    "5SIM purchase failed:",
                    error
                );

                await db.runTransaction(
                    async transaction => {

                        const userRef =
                            db
                                .collection("users")
                                .doc(
                                    uid
                                );

                        const purchaseSnapshot =
                            await transaction.get(
                                purchaseRef
                            );

                        const userSnapshot =
                            await transaction.get(
                                userRef
                            );

                        if(
                            !purchaseSnapshot.exists ||
                            !userSnapshot.exists
                        ){

                            return;

                        }

                        const userData =
                            userSnapshot.data();

                        const currentBalance =
                            Number(
                                userData[
                                    balanceField
                                ] || 0
                            );

                        const refundedBalance =
                            Number(
                                (
                                    currentBalance +
                                    numoraPrice
                                ).toFixed(2)
                            );

                        transaction.update(
                            userRef,
                            {

                                [balanceField]:
                                    refundedBalance,

                                updatedAt:
                                    serverTimestamp()

                            }
                        );

                        transaction.update(
                            purchaseRef,
                            {

                                status:
                                    "REFUNDED",

                                refundReason:
                                    error.message ||
                                    "5SIM purchase failed.",

                                refundedAmount:
                                    numoraPrice,

                                refundedAt:
                                    serverTimestamp(),

                                updatedAt:
                                    serverTimestamp()

                            }
                        );

                    }
                );

                return res.status(502).json({

                    success: false,

                    refunded:
                        true,

                    message:
                        "5SIM could not provide a number. Your Numora balance has been refunded."

                });

            }

            /*
            -------------------------------------------------
            NORMALIZE 5SIM ORDER
            -------------------------------------------------
            */

            const fiveSimOrderId =
                fiveSimOrder?.id ||
                fiveSimOrder?.order_id ||
                null;

            const phoneNumber =
                normalizePhoneNumber(
                    fiveSimOrder?.phone ||
                    fiveSimOrder?.number ||
                    fiveSimOrder?.phoneNumber ||
                    ""
                );

            if(
                !fiveSimOrderId ||
                !phoneNumber
            ){

                console.error(
                    "5SIM returned an unexpected purchase response:",
                    fiveSimOrder
                );

                /*
                The provider may have created an order even
                though the response was incomplete.

                Do NOT automatically refund in this case
                because that could create a provider-side
                purchase without a corresponding Numora
                record.
                */

                await purchaseRef.update({

                    status:
                        "PROVIDER_RESPONSE_ERROR",

                    providerResponse:
                        fiveSimOrder || null,

                    updatedAt:
                        serverTimestamp()

                });

                return res.status(502).json({

                    success: false,

                    message:
                        "5SIM created an unexpected response. Please contact Numora support before trying again."

                });

            }

            /*
            -------------------------------------------------
            SAVE 5SIM NUMBER
            -------------------------------------------------
            */

            const numberRef =
                db
                    .collection("numbers")
                    .doc(
                        String(
                            fiveSimOrderId
                        )
                    );

            const fiveSimStatus =
                fiveSimOrder?.status ||
                "PENDING";

            const expiresAt =
                fiveSimOrder?.expires ||
                fiveSimOrder?.expiresAt ||
                null;

            await db.runTransaction(
                async transaction => {

                    const numberSnapshot =
                        await transaction.get(
                            numberRef
                        );

                    if(
                        !numberSnapshot.exists
                    ){

                        transaction.set(
                            numberRef,
                            {

                                fiveSimOrderId:
                                    fiveSimOrderId,

                                userId:
                                    uid,

                                purchaseId:
                                    purchaseId,

                                pricingId:
                                    pricingDocument.id,

                                country:
                                    country,

                                countryName:
                                    getPricingCountryName(
                                        pricing
                                    ),

                                service:
                                    service,

                                serviceName:
                                    getPricingName(
                                        pricing
                                    ),

                                phoneNumber:
                                    phoneNumber,

                                operator:
                                    selectedOperator.operator,

                                provider:
                                    "5SIM",

                                providerCost:
                                    selectedOperator.cost,

                                providerCurrency:
                                    "USD",

                                providerDeliveryRate:
                                    selectedOperator.rate,

                                numoraPrice:
                                    numoraPrice,

                                currency:
                                    "NGN",

                                status:
                                    fiveSimStatus,

                                expiresAt:
                                    expiresAt,

                                sms:
                                    Array.isArray(
                                        fiveSimOrder?.sms
                                    )
                                        ? fiveSimOrder.sms
                                        : [],

                                rawProviderOrder:
                                    fiveSimOrder,

                                createdAt:
                                    serverTimestamp(),

                                updatedAt:
                                    serverTimestamp()

                            }
                        );

                    }
                    else {

                        transaction.update(
                            numberRef,
                            {

                                userId:
                                    uid,

                                purchaseId:
                                    purchaseId,

                                phoneNumber:
                                    phoneNumber,

                                status:
                                    fiveSimStatus,

                                expiresAt:
                                    expiresAt,

                                sms:
                                    Array.isArray(
                                        fiveSimOrder?.sms
                                    )
                                        ? fiveSimOrder.sms
                                        : [],

                                rawProviderOrder:
                                    fiveSimOrder,

                                updatedAt:
                                    serverTimestamp()

                            }
                        );

                    }

                    transaction.update(
                        purchaseRef,
                        {

                            status:
                                "COMPLETED",

                            fiveSimOrderId:
                                fiveSimOrderId,

                            phoneNumber:
                                phoneNumber,

                            operator:
                                selectedOperator.operator,

                            providerStatus:
                                fiveSimStatus,

                            expiresAt:
                                expiresAt,

                            completedAt:
                                serverTimestamp(),

                            updatedAt:
                                serverTimestamp()

                        }
                    );

                }
            );

            console.log(
                "5SIM NUMBER PURCHASED:",
                {

                    purchaseId,

                    fiveSimOrderId,

                    uid,

                    phoneNumber,

                    country,

                    service,

                    operator:
                        selectedOperator.operator,

                    providerCost:
                        selectedOperator.cost,

                    deliveryRate:
                        selectedOperator.rate,

                    numoraPrice

                }
            );

            return res.status(200).json({

                success: true,

                purchaseId,

                fiveSimOrderId,

                phoneNumber,

                number:
                    phoneNumber,

                country,

                service,

                price:
                    numoraPrice,

                currency:
                    "NGN",

                status:
                    fiveSimStatus,

                expiresAt,

                operator:
                    selectedOperator.operator

            });

        }
        catch(error){

            console.error(
                "Customer purchase error:",
                error
            );

            if(
                error.status ===
                401
            ){

                return res.status(401).json({

                    success: false,

                    message:
                        error.message

                });

            }

            if(
                error.status ===
                402
            ){

                return res.status(402).json({

                    success: false,

                    insufficientBalance:
                        true,

                    currentBalance:
                        error.currentBalance,

                    message:
                        error.message

                });

            }

            if(
                error.status ===
                404
            ){

                return res.status(404).json({

                    success: false,

                    message:
                        error.message

                });

            }

            return res.status(500).json({

                success: false,

                message:
                    error.message ||
                    "Unable to complete number purchase."

            });

        }

    }
);


/*
=========================================================
CUSTOMER — CHECK 5SIM ORDER
=========================================================

GET /api/customer/number/:orderId

The Firebase user must own the number.

This endpoint contacts 5SIM and updates the local
Firestore copy.

=========================================================
*/

app.get(
    "/api/customer/number/:orderId",
    async (req, res) => {

        try {

            const decodedToken =
                await authenticateCustomer(
                    req
                );

            const uid =
                decodedToken.uid;

            if(!db){

                return res.status(500).json({

                    success: false,

                    message:
                        "Firestore is unavailable."

                });

            }

            const orderId =
                String(
                    req.params.orderId ||
                    ""
                ).trim();

            if(!orderId){

                return res.status(400).json({

                    success: false,

                    message:
                        "Order ID is required."

                });

            }

            const numberRef =
                db
                    .collection("numbers")
                    .doc(
                        orderId
                    );

            const numberSnapshot =
                await numberRef.get();

            if(
                !numberSnapshot.exists
            ){

                return res.status(404).json({

                    success: false,

                    message:
                        "Number order was not found."

                });

            }

            const numberData =
                numberSnapshot.data();

            if(
                numberData.userId !==
                uid
            ){

                return res.status(403).json({

                    success: false,

                    message:
                        "You do not have access to this number."

                });

            }

            const fiveSimOrderId =
                numberData.fiveSimOrderId ||
                orderId;

            let providerOrder;

            try {

                providerOrder =
                    await fetch5SimAuthenticated(
                        `/user/check/${encodeURIComponent(fiveSimOrderId)}`
                    );

            }
            catch(error){

                console.error(
                    "5SIM order check failed:",
                    error
                );

                /*
                Return the last locally saved state instead
                of destroying the customer's active order.
                */

                return res.status(200).json({

                    success: true,

                    source:
                        "firestore",

                    providerUnavailable:
                        true,

                    order: {

                        id:
                            fiveSimOrderId,

                        phoneNumber:
                            numberData.phoneNumber,

                        country:
                            numberData.country,

                        service:
                            numberData.service,

                        status:
                            numberData.status ||
                            "PENDING",

                        expiresAt:
                            numberData.expiresAt ||
                            null,

                        sms:
                            numberData.sms || []

                    }

                });

            }

            const currentStatus =
                providerOrder?.status ||
                numberData.status ||
                "PENDING";

            const currentPhone =
                normalizePhoneNumber(
                    providerOrder?.phone ||
                    providerOrder?.number ||
                    providerOrder?.phoneNumber ||
                    numberData.phoneNumber
                );

            const currentSms =
                Array.isArray(
                    providerOrder?.sms
                )
                    ? providerOrder.sms
                    : (
                        Array.isArray(
                            numberData.sms
                        )
                            ? numberData.sms
                            : []
                    );

            const currentExpires =
                providerOrder?.expires ||
                providerOrder?.expiresAt ||
                numberData.expiresAt ||
                null;

            await numberRef.update({

                status:
                    currentStatus,

                phoneNumber:
                    currentPhone,

                expiresAt:
                    currentExpires,

                sms:
                    currentSms,

                rawProviderOrder:
                    providerOrder,

                lastCheckedAt:
                    serverTimestamp(),

                updatedAt:
                    serverTimestamp()

            });

            return res.status(200).json({

                success: true,

                source:
                    "5sim",

                order: {

                    id:
                        fiveSimOrderId,

                    phoneNumber:
                        currentPhone,

                    country:
                        numberData.country,

                    countryName:
                        numberData.countryName,

                    service:
                        numberData.service,

                    serviceName:
                        numberData.serviceName,

                    status:
                        currentStatus,

                    expiresAt:
                        currentExpires,

                    sms:
                        currentSms

                }

            });

        }
        catch(error){

            console.error(
                "Customer number check error:",
                error
            );

            if(
                error.status ===
                401
            ){

                return res.status(401).json({

                    success: false,

                    message:
                        error.message

                });

            }

            return res.status(500).json({

                success: false,

                message:
                    error.message ||
                    "Unable to check number."

            });

        }

    }
);


/*
=========================================================
CUSTOMER — GET ACTIVE NUMBERS
=========================================================

Used by the customer SMS page.

=========================================================
*/

app.get(
    "/api/customer/numbers",
    async (req, res) => {

        try {

            const decodedToken =
                await authenticateCustomer(
                    req
                );

            const uid =
                decodedToken.uid;

            if(!db){

                return res.status(500).json({

                    success: false,

                    message:
                        "Firestore is unavailable."

                });

            }

            const snapshot =
                await db
                    .collection("numbers")
                    .where(
                        "userId",
                        "==",
                        uid
                    )
                    .get();

            const numbers =
                snapshot.docs
                    .map(
                        document => {

                            const data =
                                document.data();

                            return {

                                id:
                                    document.id,

                                fiveSimOrderId:
                                    data.fiveSimOrderId ||
                                    document.id,

                                phoneNumber:
                                    data.phoneNumber ||
                                    "",

                                country:
                                    data.country ||
                                    "",

                                countryName:
                                    data.countryName ||
                                    data.country ||
                                    "",

                                service:
                                    data.service ||
                                    "",

                                serviceName:
                                    data.serviceName ||
                                    data.service ||
                                    "",

                                status:
                                    data.status ||
                                    "PENDING",

                                expiresAt:
                                    data.expiresAt ||
                                    null,

                                sms:
                                    Array.isArray(
                                        data.sms
                                    )
                                        ? data.sms
                                        : [],

                                numoraPrice:
                                    Number(
                                        data.numoraPrice ||
                                        0
                                    ),

                                createdAt:
                                    data.createdAt ||
                                    null

                            };

                        }
                    );

            numbers.sort(
                (a, b) => {

                    const aTime =
                        a.createdAt?.toMillis
                            ? a.createdAt.toMillis()
                            : 0;

                    const bTime =
                        b.createdAt?.toMillis
                            ? b.createdAt.toMillis()
                            : 0;

                    return (
                        bTime -
                        aTime
                    );

                }
            );

            return res.status(200).json({

                success: true,

                numbers

            });

        }
        catch(error){

            console.error(
                "Customer numbers error:",
                error
            );

            if(
                error.status ===
                401
            ){

                return res.status(401).json({

                    success: false,

                    message:
                        error.message

                });

            }

            return res.status(500).json({

                success: false,

                message:
                    "Unable to load customer numbers."

            });

        }

    }
);


/*
=========================================================
CUSTOMER — PURCHASE HISTORY
=========================================================
*/

app.get(
    "/api/customer/purchases",
    async (req, res) => {

        try {

            const decodedToken =
                await authenticateCustomer(
                    req
                );

            const uid =
                decodedToken.uid;

            if(!db){

                return res.status(500).json({

                    success: false,

                    message:
                        "Firestore is unavailable."

                });

            }

            const snapshot =
                await db
                    .collection("customerPurchases")
                    .where(
                        "userId",
                        "==",
                        uid
                    )
                    .limit(100)
                    .get();

            const purchases =
                snapshot.docs
                    .map(
                        document => {

                            const data =
                                document.data();

                            return {

                                id:
                                    document.id,

                                country:
                                    data.country,

                                countryName:
                                    data.countryName,

                                service:
                                    data.service,

                                serviceName:
                                    data.serviceName,

                                phoneNumber:
                                    data.phoneNumber ||
                                    null,

                                price:
                                    Number(
                                        data.numoraPrice ||
                                        0
                                    ),

                                currency:
                                    data.currency ||
                                    "NGN",

                                status:
                                    data.status ||
                                    "UNKNOWN",

                                fiveSimOrderId:
                                    data.fiveSimOrderId ||
                                    null,

                                createdAt:
                                    data.createdAt ||
                                    null

                            };

                        }
                    );

            return res.status(200).json({

                success: true,

                purchases

            });

        }
        catch(error){

            console.error(
                "Customer purchase history error:",
                error
            );

            if(
                error.status ===
                401
            ){

                return res.status(401).json({

                    success: false,

                    message:
                        error.message

                });

            }

            return res.status(500).json({

                success: false,

                message:
                    "Unable to load purchase history."

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

        console.log(
            "5SIM minimum delivery rate:",
            `${FIVESIM_MIN_DELIVERY_RATE}%`
        );

    }
);