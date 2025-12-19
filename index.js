const { MongoClient, ServerApiVersion } = require('mongodb');
const express = require('express')
const cors = require('cors')
require('dotenv').config()
const port = process.env.PORT || 5000


const app = express()
app.use(cors())
app.use(express.json())



const uri = "mongodb+srv://donateblood:EjshDOGN5g2pbYmd@cluster0.p0naaxz.mongodb.net/?appName=Cluster0";

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

    const database = client.db('donateblood')
    const userCollections = database.collection('user')
    const requestsCollection = database.collection('requests') 

    app.post('/users', async (req, res) =>{
        const userInfo = req.body
        userInfo.createdAt = new Date()
        userInfo.role = 'donor'
        userInfo.status = 'active'
        const result = await userCollections.insertOne(userInfo)
        res.send(result)
    })

        app.get('/users/role/:email', async (req, res) =>{
      const {email} = req.params
      const query = {email:email}
      const result = await userCollections.findOne(query)
      res.send(result)
    })

    app.post('/requests', async (req, res) =>{
      const data = req.body
      data.createdAt = new Date()
      const result = await requestsCollection.insertOne(data) 
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


app.get('/', (req, res) =>{
    res.send('hello, dev')
})

app.listen(port, ()=>{
    console.log(`server is running on ${port}`)
})