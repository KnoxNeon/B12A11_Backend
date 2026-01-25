const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const express = require('express')
const cors = require('cors')
require('dotenv').config()
const port = process.env.PORT || 3000
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

const verifyFBToken = async (req, res, next) => {
    const token = req.headers.authorization;
    if(!token){
        return res.status(401).send({message: 'Unauthorized Access'})
    }
    try {
        const idToken = token.split(' ')[1] 
        const decoded = await admin.auth().verifyIdToken(idToken)
        req.decoded_email = decoded.email
        next()
    } catch (error) {
        return res.status(401).send({message: 'Unauthorized Access'})  
    }
}

const uri = `mongodb+srv://donateblood:EjshDOGN5g2pbYmd@cluster0.p0naaxz.mongodb.net/?appName=Cluster0`;

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
        // Connect the client to the server (optional starting in v4.7)
        await client.connect();
        
        const database = client.db('donateblood')
        const userCollections = database.collection('user')
        const requestsCollection = database.collection('requests') 
        const paymentsCollection = database.collection('payments') 

        app.post('/users', async (req, res) => {
            const userInfo = req.body
            userInfo.createdAt = new Date()
            userInfo.role = 'donor'
            userInfo.status = 'active'
            const result = await userCollections.insertOne(userInfo)
            res.send(result)
        })

        app.get('/users', verifyFBToken, async (req, res) => {
            const result = await userCollections.find().toArray()
            res.status(200).send(result)
        })

        app.get('/users/role/:email', async (req, res) => {
            const {email} = req.params
            const query = {email:email}
            const result = await userCollections.findOne(query)
            res.send(result)
        })

        app.get('/users/:email', async(req, res) => {
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

        app.patch('/update/user/status', verifyFBToken, async (req, res) => {
            const {email, status, role} = req.query
            const query = {email:email}
            const actions = {}
            if(role){
                actions.role = role;
            }
            if(status){
                actions.status = status;
            }
            const result = await userCollections.updateOne(query, {$set : actions})
            res.send(result)
        })

        app.post('/requests', verifyFBToken, async (req, res) => {
            const data = req.body
            data.createdAt = new Date()
            const result = await requestsCollection.insertOne(data) 
            res.send(result)
        })

        app.get('/all-requests', verifyFBToken, async (req, res) => {
            const email = req.decoded_email;
            const currentUser = await userCollections.findOne({ email: email });
            const size = Number(req.query.size) || 10;
            const page = Number(req.query.page) || 0;
            
            try {
                const allRequests = await requestsCollection.find({}).sort({ createdAt: -1 }).skip(page * size).limit(size).toArray();
                const totalRequests = await requestsCollection.countDocuments({});
                res.send({
                    requests: allRequests, 
                    totalRequests: totalRequests
                });
            } catch (err) {
                console.error(err);
                res.status(500).send({ message: 'Server error' });
            }
        });

        app.get('/my-request', verifyFBToken, async(req, res) => {
            const email = req.decoded_email
            const size = Number(req.query.size)
            const page = Number(req.query.page)
            const query = {requester_email:email}
            const result = await requestsCollection.find(query).limit(size).skip(size*page).toArray()
            const totalRequest = await requestsCollection.countDocuments(query)
            res.send({request: result, totalRequest})
        })

        app.get('/my-recent-requests', verifyFBToken, async (req, res) => {
            const email = req.decoded_email;
            const recentRequests = await requestsCollection.find({ requester_email: email }).sort({ createdAt: -1 }) // Sort by newest first
                .limit(3)
                .toArray();
            res.send(recentRequests);
        });

        
        app.patch('/requests/:id/status', verifyFBToken, async (req, res) => {
            try {
                const { id } = req.params;
                const { donation_status, status, updated_by, updated_at } = req.body;
                const userEmail = req.decoded_email;

                // Get user role from your user collection
                const user = await userCollections.findOne({ email: userEmail });
                
                let filter = { _id: new ObjectId(id) };
                
                // If user is not admin/volunteer, they can only update their own requests
                if (!user || (user.role !== 'admin' && user.role !== 'volunteer')) {
                    filter.requester_email = userEmail;
                }

                console.log('Updating request with filter:', filter);
                console.log('User role:', user?.role);
                console.log('Update data:', { donation_status, status, updated_by, updated_at });

                // Use donation_status if provided, otherwise fall back to status for backward compatibility
                const statusToUpdate = donation_status || status;

                const result = await requestsCollection.updateOne(
                    filter,
                    { $set: { 
                        donation_status: statusToUpdate,
                        status: statusToUpdate, // Update both fields for compatibility
                        updated_by: updated_by || userEmail,
                        updated_at: updated_at || new Date().toISOString()
                    }}
                );

                console.log('Update result:', result);

                if (result.matchedCount === 0) {
                    return res.status(404).send({ error: 'Request not found or access denied' });
                }

                res.send({ success: true, message: 'Request status updated successfully', result });
            } catch (error) {
                console.error('Error updating request status:', error);
                res.status(500).send({ error: 'Internal server error' });
            }
        });

        app.delete('/requests/:id', verifyFBToken, async (req, res) => {
            const { id } = req.params;
            const result = await requestsCollection.deleteOne({
                _id: new ObjectId(id),
                requester_email: req.decoded_email
            });
            res.send(result);
        });

        app.get('/available-requests', verifyFBToken, async (req, res) => {
            try {
                const { status, exclude_email } = req.query;
                const userEmail = req.decoded_email;
                
                const filter = {
                    donation_status: status || 'inprogress',  
                    requester_email: { $ne: exclude_email || userEmail }
                };
                
                const requests = await requestsCollection.find(filter).sort({ createdAt: -1 }).toArray();
                res.send(requests);
            } catch (error) {
                console.error('Error fetching available requests:', error);
                res.status(500).send({ error: 'Internal server error' });
            }
        });

        // 2. Donor responds to a request (changes status to completed)
        app.patch('/respond-to-request/:id', verifyFBToken, async (req, res) => {
            try {
                const { id } = req.params;
                const { donation_status, donor_name, donor_email, completed_at } = req.body;
                const userEmail = req.decoded_email;

                // Verify the user is not responding to their own request
                const request = await requestsCollection.findOne({ _id: new ObjectId(id) });
                if (!request) {
                    return res.status(404).send({ error: 'Request not found' });
                }
                
                if (request.requester_email === userEmail) {
                    return res.status(403).send({ error: 'Cannot respond to your own request' });
                }

                // Update request with donor response
                const result = await requestsCollection.updateOne(
                    { 
                        _id: new ObjectId(id), 
                        donation_status: 'inprogress' // Only allow response to in-progress requests
                    },
                    { 
                        $set: { 
                            donation_status: 'completed',
                            status: 'completed', // Update both fields for compatibility
                            donor_name,
                            donor_email,
                            completed_at,
                            responded_by: userEmail
                        } 
                    }
                );

                if (result.matchedCount === 0) {
                    return res.status(400).send({ error: 'Request not available for response' });
                }

                res.send(result);
            } catch (error) {
                console.error('Error responding to request:', error);
                res.status(500).send({ error: 'Internal server error' });
            }
        });

        // Admin/Volunteer endpoint to update any request status
        app.patch('/admin/requests/:id/status', verifyFBToken, async (req, res) => {
            try {
                const { id } = req.params;
                const { donation_status, updated_by, updated_at } = req.body;

                // Get user role from your user collection
                const userEmail = req.decoded_email;
                const user = await userCollections.findOne({ email: userEmail }); // ✅ Fixed collection name

                // Check if user is admin or volunteer
                if (!user || (user.role !== 'admin' && user.role !== 'volunteer')) {
                    return res.status(403).send({ error: 'Unauthorized. Admin or volunteer access required.' });
                }

                console.log('Admin endpoint - Updating request:', id);
                console.log('User role:', user.role);
                console.log('Update data:', { donation_status, updated_by, updated_at });

                // Update request status
                const result = await requestsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { 
                        $set: { 
                            donation_status,
                            status: donation_status, // Update both fields for compatibility
                            updated_by: updated_by || userEmail,
                            updated_at: updated_at || new Date().toISOString()
                        } 
                    }
                );

                console.log('Admin endpoint - Update result:', result);

                if (result.matchedCount === 0) {
                    return res.status(404).send({ error: 'Request not found' });
                }

                res.send({ success: true, message: 'Request status updated successfully', result });
            } catch (error) {
                console.error('Error updating request status:', error);
                res.status(500).send({ error: 'Internal server error' });
            }
        });

        // Admin-only endpoint to delete any request
        app.delete('/admin/requests/:id', verifyFBToken, async (req, res) => {
            try {
                const { id } = req.params;

                // Get user role from your user collection
                const userEmail = req.decoded_email;
                const user = await userCollections.findOne({ email: userEmail }); 

                // Check if user is admin
                if (!user || user.role !== 'admin') {
                    return res.status(403).send({ error: 'Unauthorized. Admin access required.' });
                }

                // Delete any request (no requester_email filter)
                const result = await requestsCollection.deleteOne({ _id: new ObjectId(id) });

                if (result.deletedCount === 0) {
                    return res.status(404).send({ error: 'Request not found' });
                }

                res.send({ message: 'Request deleted successfully', deletedCount: result.deletedCount });
            } catch (error) {
                console.error('Error deleting request:', error);
                res.status(500).send({ error: 'Internal server error' });
            }
        });

        app.get('/search-requests', async (req,res) => {
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

        app.get('/admin-stats', verifyFBToken, async (req, res) => {
            const user = await userCollections.findOne({ email: req.decoded_email });
            if (user?.role !== 'admin') {
                return res.status(403).send({ message: 'Forbidden' });
            }

            const totalUsers = await userCollections.countDocuments({ role: 'donor' });
            const totalRequests = await requestsCollection.countDocuments({});
            const fundingResult = await paymentsCollection.aggregate([
                { $match: { payment_status: 'paid' } },
                { $group: { _id: null, total: { $sum: '$amount' } } }
            ]).toArray();
            const totalFunding = fundingResult[0]?.total || 0;

            res.send({
                totalUsers,
                totalFunding,
                totalRequests,
            });
        });

        app.get('/all-requests-stats', verifyFBToken, async (req, res) => {
        try {
          const totalRequests = await requestsCollection.countDocuments({});
        
        // Get counts for each status
          const pendingCount = await requestsCollection.countDocuments({
            $or: [
                { donation_status: 'pending' },
                { status: 'pending' }
            ]
          });
        
          const inprogressCount = await requestsCollection.countDocuments({
            $or: [
                { donation_status: 'inprogress' },
                { status: 'inprogress' }
            ]
          });
        
          const completedCount = await requestsCollection.countDocuments({
            $or: [
                { donation_status: 'completed' },
                { status: 'completed' }
            ]
          });
        
          const rejectedCount = await requestsCollection.countDocuments({
            $or: [
                { donation_status: 'rejected' },
                { status: 'rejected' }
            ]
          });

          res.send({
            total: totalRequests,
            pending: pendingCount,
            inprogress: inprogressCount,
            completed: completedCount,
            rejected: rejectedCount
          });
      } catch (error) {
        console.error('Error fetching request stats:', error);
        res.status(500).send({ error: 'Internal server error' });
      }
  });

        app.get('/public-requests', async (req, res) => {
            try {
                const requests = await requestsCollection.find({ 
                    status: { $nin: ['done', 'canceled'] } 
                }).sort({ createdAt: -1 }).toArray();
                
                res.send({
                    requests,
                    totalRequests: requests.length
                });
            } catch (err) {
                console.error(err);
                res.status(500).send({ message: 'Server error' });
            }
        });

        app.post('/create-payment-checkout', async (req,res) => {
            const information = req.body
            const amount = parseInt(information.donateAmount)*100
            const session = await stripe.checkout.sessions.create({
                line_items: [{
                    price_data: {
                        currency: 'usd',
                        unit_amount: amount,
                        product_data:{
                            name: 'Please Donate'
                        }
                    },
                    quantity: 1,
                }],
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

        app.post('/success-payment',async (req, res) => {
            const {session_id} = req.query
            const session = await stripe.checkout.sessions.retrieve(session_id)
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
        
        app.listen(port, () => {
            console.log(`server is running on ${port}`)
        })
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}

run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('hello, dev')
})
