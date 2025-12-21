const { MongoClient, ServerApiVersion } = require('mongodb');
const express = require('express')
const cors = require('cors')
require('dotenv').config()
const port = process.env.PORT || 5000
const stripe = require('stripe')(process.env.STRIPE_SECRET)
const crypto = require('crypto')


const app = express()
app.use(cors())
app.use(express.json())

// const serviceAccount = require("./firebase-admin-key.json");
const admin = require("firebase-admin");

const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8')
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const verifyFBToken = async (req, res, next) =>{
    const token = req.headers.authorization;

    if(!token){
        return res.status(401).send({message: 'Unauthorized Access'})
    
    }

    try {
       const idToken = token.split(' ')[1] 
       const decoded = await admin.auth().verifyIdToken(idToken)
       req.decoded_email = decoded.email
       next()
    } 
    catch (error) {
        return res.status(401).send({message: 'Unauthorized Access'})  
    }
}



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
    const paymentsCollection = database.collection('payments') 

    app.post('/users', async (req, res) =>{
        const userInfo = req.body
        userInfo.createdAt = new Date()
        userInfo.role = 'donor'
        userInfo.status = 'active'
        const result = await userCollections.insertOne(userInfo)
        res.send(result)
    })

    app.get('/users', verifyFBToken, async (req, res) =>{
        const result = await userCollections.find().toArray()
        res.status(200).send(result)
    })

      app.get('/users/role/:email', async (req, res) =>{
      const {email} = req.params
      const query = {email:email}
      const result = await userCollections.findOne(query)
      res.send(result)
    })

    app.get('/users/:email', async(req, res) =>{
        const email = req.params.email
        const query = {email:email}
        const result = await userCollections.findOne(query)
        res.send(result)
    })

    app.patch('/users/:email', verifyFBToken, async (req, res) => {
        const email = req.params.email;
        const updates = req.body;
        const query = { email: email };
        const updateDoc = {
          $set: updates
   };

        const result = await userCollections.updateOne(query, updateDoc);
        res.send(result);
    });

    app.patch('/update/user/status', verifyFBToken, async (req, res)=>{
        const {email, status} = req.query
        const query = {email:email}

        const updateStatus = {
            $set: {
                status: status
            }
        }
        const result = await userCollections.updateOne(query, updateStatus)
        res.send(result)
    })

    app.post('/requests', verifyFBToken, async (req, res) =>{
      const data = req.body
      data.createdAt = new Date()
      const result = await requestsCollection.insertOne(data) 
      res.send(result)
    })

    app.get('/my-request', verifyFBToken, async(req, res) =>{
        const email = req.decoded_email
        const size = Number(req.query.size)
        const page = Number(req.query.page)
        const query = {requester_email:email}
        const result = await requestsCollection
        .find(query)
        .limit(size)
        .skip(size*page)
        .toArray()

        const totalRequest = await requestsCollection.countDocuments(query)
        res.send({request: result, totalRequest})
    })

    app.get('/my-recent-requests', verifyFBToken, async (req, res) => {
        const email = req.decoded_email;

        const recentRequests = await requestsCollection
        .find({ requester_email: email })
        .sort({ createdAt: -1 }) // Sort by newest first
        .limit(3)
        .toArray();

         res.send(recentRequests);
    });

    app.patch('/requests/:id/status', verifyFBToken, async (req, res) => {
        const { id } = req.params;
        const { status } = req.body;
        const result = await requestsCollection.updateOne(
          { _id: new ObjectId(id), requester_email: req.decoded_email },
          { $set: { status } }
        );
         res.send(result);
    });

    app.delete('/requests/:id', verifyFBToken, async (req, res) => {
        const { id } = req.params;
        const result = await requestsCollection.deleteOne({
         _id: new ObjectId(id),
         requester_email: req.decoded_email
         });
         res.send(result);
    });

    app.get('/search-requests', async (req,res) =>{
      const {bloodGroup, district, upazila} = req.query

      const query = {}

      if(!query){
        return;
      }

      if(bloodGroup){
        const fixed = bloodGroup.replace(/ /g,"+").trim()
        query.blood_group = fixed
      }
      if(district){
        query.recipient_district = district
      }
      if(upazila){
        query.recipient_upazila = upazila
      }
      const result = await requestsCollection.find(query).toArray()
      res.send(result)

      console.log(query)
    })

    app.post('/create-payment-checkout', async (req,res)=>{
        const information = req.body
        const amount = parseInt(information.donateAmount)*100

        const session = await stripe.checkout.sessions.create({
          
          line_items: [
            {
              price_data: {
                currency: 'usd',
                unit_amount: amount,
                product_data:{
                  name: 'Please Donate'
                }
              },
              quantity: 1,
            }
          ],
          mode: 'payment',
          metadata: {
            donorName: information?.donorName
          },
          customer_email: information?.donorEmail,
          success_url: `${process.env.SITE_DOMAIN}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.SITE_DOMAIN}/payment-cancelled`,
        })

        res.send({url: session.url})
    })

    app.post('/success-payment',async (req, res)=>{
      const {session_id} = req.query
      const session = await stripe.checkout.sessions.retrieve(
        session_id
        
      )
      console.log(session)

      const transactionId = session.payment_intent;
      const isPaymentExists = await paymentsCollection.findOne({transactionId})

      if(isPaymentExists){
        return
      }

      if(session.payment_status == 'paid'){
        const paymentInfo = {
          amount: session.amount_total/100,
          currency: session.currency,
          donorEmail: session.customer_email,
          transactionId,
          payment_status: session.payment_status,
          paidAt: new Date()
        }

        const result = await paymentsCollection.insertOne(paymentInfo)
        return res.send(result)
      }
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