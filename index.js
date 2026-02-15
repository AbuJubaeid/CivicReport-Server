const express = require("express");
const app = express();
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const port = process.env.PORT || 3000;
const stripe = require("stripe")(process.env.STRIPE_SECRET);
const crypto = require("crypto");

const admin = require("firebase-admin");

const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
  "utf8",
);
const serviceAccount = JSON.parse(decoded);

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

    // ==>middleware for verifing admin

    const verifyAdminToken = async (req, res, next) => {
      const email = req.decoded_email;
      const query = { email };
      const user = await usersCollection.findOne(query);

      if (!user || user.role !== "admin") {
        return res.status(403).send({ message: "forbidden access" });
      }

      next();
    };

    //==> users related apis are here

    // get all the users
    app.get("/users", verifyFBToken, async (req, res) => {
      const searchUser = req.query.searchUser;
      const query = {};

      if (searchUser) {
        query.$or = [
          { displayName: { $regex: searchUser, $options: "i" } },
          { email: { $regex: searchUser, $options: "i" } },
        ];
      }
      const cursor = usersCollection
        .find(query)
        .sort({ createdAt: -1 })
        .limit(5);
      const result = await cursor.toArray();
      res.send(result);
    });

    // create user
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

    // get current loggedin user
    app.get("/users/me", verifyFBToken, async (req, res) => {
      try {
        const email = req.decoded_email;
        const user = await usersCollection.findOne({ email });

        if (!user) {
          return res.status(404).send({ message: "User not found" });
        }

        res.send(user);
      } catch (err) {
        console.error("GET /users/me error:", err);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    // update current loggedin user
    app.patch("/users/me", verifyFBToken, async (req, res) => {
      try {
        const email = req.decoded_email;

        const updateDoc = {
          $set: {
            displayName: req.body.displayName,
            email: req.body.email,
            photoURL: req.body.photoURL,
          },
        };

        const result = await usersCollection.updateOne({ email }, updateDoc);
        res.send(result);
      } catch (err) {
        console.error("PATCH /users/me error:", err);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    // change admin role
    app.patch(
      "/users/:id/role",
      verifyFBToken,
      verifyAdminToken,
      async (req, res) => {
        const id = req.params.id;
        const roleInfo = req.body;
        const query = { _id: new ObjectId(id) };
        const update = {
          $set: {
            role: roleInfo.role,
          },
        };
        const result = await usersCollection.updateOne(query, update);
        res.send(result);
      },
    );

    app.get("/users/:email/role", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      res.send({ role: user?.role || "user" });
    });

    //==> staff related apis are here
    app.post("/staffs", async (req, res) => {
      const staff = req.body;
      staff.status = "pending";
      staff.createdAt = new Date();

      const result = await staffsCollection.insertOne(staff);
      res.send(result);
    });

    // get all the staffs
    app.get("/staffs", async (req, res) => {
      const { status, address, workStatus } = req.query;
      const query = {};

      if (status) {
        query.status = status;
      }

      if (workStatus) {
        query.workStatus = workStatus;
      }

      const cursor = staffsCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    // update staffs status
    app.patch(
      "/staffs/:id",
      verifyFBToken,
      verifyAdminToken,
      async (req, res) => {
        const status = req.body.status;
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const updatedDoc = {
          $set: {
            status: status,
            workStatus: "available",
          },
        };

        const result = await staffsCollection.updateOne(query, updatedDoc);

        if (status === "approved") {
          const email = req.body.email;
          const userQuery = { email };
          const updateUser = {
            $set: {
              role: "staff",
            },
          };
          const userResult = await usersCollection.updateOne(
            userQuery,
            updateUser,
          );
        }

        res.send(result);
      },
    );

    // delete a staff from database
    app.delete("/staffs/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await staffsCollection.deleteOne(query);
      res.send(result);
    });

    // // get report for a single person and search

    app.get("/reports", async (req, res) => {
      const { email, reportStatus, category, status, priority, search } =
        req.query;
      const query = {};

      if (email) {
        query.email = email;
      }

      if (reportStatus) {
        query.reportStatus = reportStatus;
      }

      if (category) query.category = category;
      if (status) query.reportStatus = status;
      if (priority) query.priority = priority;

      if (search) {
        query.$or = [
          { issue: { $regex: search, $options: "i" } },
          { category: { $regex: search, $options: "i" } },
          { location: { $regex: search, $options: "i" } },
        ];
      }

      const options = { sort: { createdAt: -1 } };
      const cursor = reportsCollection.find(query, options);
      const result = await cursor.toArray();
      res.send(result);
    });

    // get report for staff task
    app.get("/reports/staff", async (req, res) => {
      const { staffEmail, reportStatus } = req.query;
      const query = {};

      if (staffEmail) {
        query.staffEmail = staffEmail;
      }

      if (reportStatus !== "Solved") {
        query.reportStatus = { $nin: ["Solved"] };
      } else {
        query.reportStatus = reportStatus;
      }

      const cursor = reportsCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    // get recent reports
    app.get("/reports/latest", async (req, res) => {
      const result = await reportsCollection
        .find()
        .sort({ createdAt: -1 })
        .limit(4)
        .toArray();

      res.send(result);
    });

    // get latest resolved reports
    app.get("/reports/latest/solved", async (req, res) => {
      const query = {
        reportStatus: "Solved",
      };

      const result = await reportsCollection
        .find(query)
        .sort({ createdAt: -1 })
        .limit(8)
        .toArray();

      res.send(result);
    });

    // get a report
    app.get("/reports/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await reportsCollection.findOne(query);
      res.send(result);
    });

    // add a report to database
    app.post("/reports", async (req, res) => {
      const report = req.body;
      report.createdAt = new Date();
      const result = await reportsCollection.insertOne(report);
      res.send(result);
    });

    // update/edit reports information
    app.patch("/reports/:id", async (req, res) => {
      const id = req.params.id;
      const updatedData = req.body;

      const result = await reportsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updatedData },
      );

      res.send(result);
    });

    // change a reports status
    app.patch("/reports/:id", async (req, res) => {
      const { staffId, staffName, staffEmail } = req.body;
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };

      const updatedDoc = {
        $set: {
          reportStatus: "In-Progress",
          staffId: staffId,
          staffName: staffName,
          staffEmail: staffEmail,
        },
      };

      const result = await reportsCollection.updateOne(query, updatedDoc);

      // update staff information
      const staffQuery = { _id: new ObjectId(staffId) };
      const staffUpdatedDoc = {
        $set: {
          workStatus: "working",
        },
      };
      const staffResult = await staffsCollection.updateOne(
        staffQuery,
        staffUpdatedDoc,
      );

      res.send(staffResult);
    });

    app.patch("/reports/:id/status", async (req, res) => {
      const { reportStatus, staffId } = req.body;
      const query = { _id: new ObjectId(req.params.id) };
      const updatedDoc = {
        $set: {
          reportStatus: reportStatus,
        },
      };

      if (reportStatus === "Solved") {
        // update staff information
        const staffQuery = { _id: new ObjectId(staffId) };
        const staffUpdatedDoc = {
          $set: {
            workStatus: "available",
          },
        };
        const staffResult = await staffsCollection.updateOne(
          staffQuery,
          staffUpdatedDoc,
        );
      }

      const result = await reportsCollection.updateOne(query, updatedDoc);
      res.send(result);
    });

    // delete a report from database
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
              unit_amount: 100,
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
      try {
        const sessionId = req.query.session_id;
        const session = await stripe.checkout.sessions.retrieve(sessionId);

        if (session.payment_status !== "paid") {
          return res.status(400).send({ success: false });
        }

        const transactionId = session.payment_intent;
        const trackingId = generateTrackingId();

        // 🔒 Atomic upsert (no duplicates possible)
        const paymentResult = await paymentCollection.updateOne(
          { transactionId },
          {
            $setOnInsert: {
              amount: session.amount_total,
              currency: session.currency,
              email: session.customer_email,
              reportId: session.metadata.reportId,
              name: session.metadata.name,
              transactionId,
              paymentStatus: session.payment_status,
              paidAt: new Date(),
              trackingId,
            },
          },
          { upsert: true },
        );

        // If payment already existed
        if (!paymentResult.upsertedId) {
          return res.send({
            success: true,
            message: "Payment already processed",
            transactionId,
          });
        }

        // ✅ Update report ONLY ONCE
        await reportsCollection.updateOne(
          { _id: new ObjectId(session.metadata.reportId) },
          {
            $set: {
              paymentStatus: "paid",
              reportStatus: "pending",
              priority: "High-Priority",
              trakingId: trackingId,
            },
          },
        );

        res.send({
          success: true,
          transactionId,
          trackingId,
        });
      } catch (err) {
        console.error(err);
        res.status(500).send({ success: false, error: err.message });
      }
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
    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!",
    // );
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
