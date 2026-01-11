const express = require("express");
const app = express();
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const port = process.env.PORT || 3000;
const stripe = require("stripe")(process.env.STRIPE_SECRET);
const crypto = require("crypto");

const admin = require("firebase-admin");

const serviceAccount = require("./civicreport-firebase-adminsdk.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

function generateTrackingId() {
  const prefix = "PRCL";
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const random = crypto.randomBytes(3).toString("hex").toUpperCase();

  return `${prefix}-${date}-${random}`;
}

// middleware
app.use(express.json());
app.use(cors());

const verifyFBToken = async (req, res, next) => {
  const token = req.headers?.authorization;

  if (!token) {
    return res.status(401).send({ message: "Unauthorized access" });
  }

  try {
    const idToken = token.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    req.decoded_email = decoded.email;
    console.log("decoded in the token", decoded);
  } catch (err) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  next();
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ke2w89y.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db("CivicReport_db");
    const usersCollection = db.collection("users");
    const reportsCollection = db.collection("reports");
    const paymentCollection = db.collection("payments");
    const staffsCollection = db.collection("staff");

    //==> users related apis are here
    app.post("/users", async (req, res) => {
      const user = req.body;
      user.role = "user";
      user.createdAt = new Date();

      const email = user.email;
      const userExsist = await usersCollection.findOne({ email });
      if (userExsist) {
        return res.send({ message: "User already exists" });
      }
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });


    //==> staff related apis are here
    app.post('/staffs', async(req, res)=>{
      const staff = req.body
      staff.status = 'pending'
      staff.createdAt = new Date()

      const result = await staffsCollection.insertOne(staff)
      res.send(result)
    })

    // get all the staffs
    app.get('/staffs', async(req, res)=>{
      const query = {}
      if(req.query.status){
        query.status = req.query.status
      } 
      const cursor = staffsCollection.find(query)
      const result = await cursor.toArray()
      res.send(result)
    })

    // update staffs status
     app.patch('/staffs/:id', verifyFBToken, async (req, res) => {
            const status = req.body.status;
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const updatedDoc = {
                $set: {
                    status: status
                }
            }

            const result = await staffsCollection.updateOne(query, updatedDoc);
            res.send(result);
        })
      
      // delete a staff from database
      app.delete("/staffs/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await staffsCollection.deleteOne(query);
      res.send(result);
    });


    // get report for a single person
    app.get("/reports", async (req, res) => {
      const query = {};
      const { email } = req.query;
      if (email) {
        query.email = email;
      }
      const options = { sort: { createdAt: -1 } };
      const cursor = reportsCollection.find(query, options);
      const result = await cursor.toArray();
      res.send(result);
    });

    // get a report
    app.get("/reports/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await reportsCollection.findOne(query);
      res.send(result);
    });

    // add a parcel to database
    app.post("/reports", async (req, res) => {
      const report = req.body;
      report.createdAt = new Date();
      const result = await reportsCollection.insertOne(report);
      res.send(result);
    });

    // delete a parcel from database
    app.delete("/reports/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await reportsCollection.deleteOne(query);
      res.send(result);
    });

    //==> payment apis are here

    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "USD",
              unit_amount: 200,
              product_data: {
                name: paymentInfo.issue,
              },
            },
            quantity: 1,
          },
        ],
        customer_email: paymentInfo.email,
        mode: "payment",
        metadata: {
          reportId: paymentInfo.reportId,
          name: paymentInfo.issue,
        },
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
      });
      console.log(session);
      res.send({ url: session.url });
    });

    app.patch("/payment-success", async (req, res) => {
      const sessionId = req.query.session_id;
      console.log("sessionid", sessionId);
      const session = await stripe.checkout.sessions.retrieve(sessionId);

      const transactionId = session.payment_intent;
      const query = { transactionId: transactionId };
      const paymentExist = await paymentCollection.findOne(query);

      if (paymentExist) {
        return {
          message: "already exist",
          transactionId,
          trackingId: paymentExist.trackingId,
        };
      }

      const trackingId = generateTrackingId();

      console.log("session retrive", session);
      if (session.payment_status === "paid") {
        const id = session.metadata.reportId;
        const query = { _id: new ObjectId(id) };
        const update = {
          $set: {
            paymentStatus: "paid",
            trakingId: generateTrackingId(),
          },
        };
        const result = await reportsCollection.updateOne(query, update);

        const payment = {
          amount: session.amount_total,
          currency: session.currency,
          email: session.customer_email,
          reportId: session.metadata.reportId,
          name: session.metadata.name,
          transactionId: session.payment_intent,
          paymentStatus: session.payment_status,
          paidAt: new Date(),
          trackingId: trackingId,
        };

        if (session.payment_status === "paid") {
          const resultPayment = await paymentCollection.insertOne(payment);

          res.send({
            success: true,
            modifyReport: result,
            trackingId: trackingId,
            transactionId: session.payment_intent,
            paymentInfo: resultPayment,
          });
        }
      }

      res.send({ success: false });
    });

    // getting payment history
    app.get("/payments", verifyFBToken, async (req, res) => {
      const email = req.query.email;
      const query = {};

      if (email) {
        query.email = email;
      }

      // check email address
      if (email !== req.decoded_email) {
        return res.status(403).send({ message: "forbidden access" });
      }
      const cursor = paymentCollection.find(query).sort({ paidAt: -1 });
      const result = await cursor.toArray();
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
