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


    if(req.method === "OPTIONS"){

        return res.sendStatus(204);

    }


    next();

});


app.use(express.json());


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
PAYSTACK BANK TRANSFER
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


            /*
            -------------------------------------------------
            PAYSTACK SECRET KEY
            -------------------------------------------------
            */

            const secretKey =
                process.env.PAYSTACK_SECRET_KEY;


            if(!secretKey){

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

            if(!paystackResponse.ok){

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