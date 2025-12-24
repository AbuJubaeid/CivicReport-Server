const express = require('express')
const app = express()
const cors = require('cors')
require('dotenv').config()
const { MongoClient, ServerApiVersion } = require('mongodb');
const port = process.env.PORT || 3000

// middleware
app.use(express.json())
app.use(cors())


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ke2w89y.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});


async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db('CivicReport_db')
    const reportsCollection = db.collection('reports')

    // reports api
    // get all the reports
    app.get('/reports', async(req, res)=>{
      const query = {}
      const cursor = reportsCollection.find(query)
      const result = await cursor.toArray()
      res.send(result) 
    })

    // get report for a single person
     app.get('/reports', async(req, res)=>{
      const query = {}
      const {email} = req.query
      if(email){
        query.email = email
      }
      const cursor = reportsCollection.find(query)
      const result = await cursor.toArray()
      res.send(result) 
    })

    app.post('/reports', async(req, res)=>{
      const report = req.body
      const result = await reportsCollection.insertOne(report)
      res.send(result)
    })



    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);


app.get('/', (req, res) => {
  res.send('Hello World!')
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})


// const express = require("express");
// const cors = require("cors");
// require("dotenv").config();
// const { MongoClient, ServerApiVersion } = require("mongodb");

// const app = express();
// const port = process.env.PORT || 3000;

// app.use(express.json());
// app.use(cors());

// const encodedPass = encodeURIComponent(process.env.DB_PASS);
// const uri = `mongodb+srv://${process.env.DB_USER}:${encodedPass}@cluster0.ke2w89y.mongodb.net/?retryWrites=true&w=majority`;

// const client = new MongoClient(uri, {
//   serverApi: {
//     version: ServerApiVersion.v1,
//     strict: true,
//     deprecationErrors: true,
//   },
// });

// async function startServer() {
//   try {
//     await client.connect();
//     console.log("MongoDB connected");

//     app.get("/", (req, res) => {
//       res.send("Hello World!");
//     });

//     app.listen(port, () => {
//       console.log(`Server running on port ${port}`);
//     });

//   } catch (error) {
//     console.error("Server failed to start ❌", error);
//   }
// }

// startServer();
