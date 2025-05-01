const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const port = 3000;

const app = express();
app.use(express.json());

let db;

async function connectToMongoDB() {
    const uri = "mongodb://localhost:27017";
    const client = new MongoClient(uri);

    try {
        await client.connect();
        console.log("Connected to MongoDB!");
        db = client.db("JPJeQDB"); // More descriptive database name
    } catch (err) {
        console.error("Error:", err);
    }
}
connectToMongoDB();

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});

// --- Customer Use Cases ---

// Use Case: Register
// Endpoint: /customers/register
// Method: POST
// Status Codes: 201 Created, 400 Bad Request
app.post('/customers/register', async (req, res) => {
    try {
        const { username, password, email } = req.body;
        const result = await db.collection('customers').insertOne({ username, password, email });
        res.status(201).json({ message: 'Registration successful', customerId: result.insertedId });
    } catch (err) {
        console.error("Error registering customer:", err);
        res.status(400).json({ error: "Invalid registration data" });
    }
});

// Use Case: Login
// Endpoint: /customers/login
// Method: POST
// Status Codes: 200 OK, 401 Unauthorized
app.post('/customers/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const customer = await db.collection('customers').findOne({ username, password });
        if (customer) {
            res.status(200).json({ message: 'Login successful', customerId: customer._id });
        } else {
            res.status(401).json({ error: "Invalid credentials" });
        }
    } catch (err) {
        console.error("Error during login:", err);
        res.status(500).json({ error: "Login failed" });
    }
});

// Use Case: Obtain queueing number
// Endpoint: /queue/obtain
// Method: POST
// Request Body: { customerId: "..." , locationId: "...", appointmentCategoryId: "..." }
// Status Codes: 201 Created, 400 Bad Request, 503 Service Unavailable
app.post('/queue/obtain', async (req, res) => {
    try {
        const { customerId, locationId, appointmentCategoryId } = req.body;

        if (!ObjectId.isValid(customerId) || !ObjectId.isValid(locationId) || !ObjectId.isValid(appointmentCategoryId)) {
            return res.status(400).json({ error: "Invalid input IDs" });
        }

        const customer = await db.collection('customers').findOne({ _id: new ObjectId(customerId) });
        const location = await db.collection('locations').findOne({ _id: new ObjectId(locationId) });
        const appointmentCategory = await db.collection('categories').findOne({ _id: new ObjectId(appointmentCategoryId) });

        if (!customer || !location || !appointmentCategory) {
            return res.status(400).json({ error: "Invalid customer, location, or appointment category" });
        }

        const nextQueueNumber = await getNextQueueNumber(appointmentCategoryId);
        const result = await db.collection('queue').insertOne({
            customerId: new ObjectId(customerId),
            locationId: new ObjectId(locationId),
            appointmentCategoryId: new ObjectId(appointmentCategoryId),
            number: nextQueueNumber,
            timestamp: new Date(),
            served: false // Initially not served
        });

        res.status(201).json({ message: 'Queue number obtained', queueNumber: nextQueueNumber });
    } catch (err) {
        console.error("Error obtaining queue number:", err);
        res.status(503).json({ error: "Failed to obtain queue number" });
    }
});

async function getNextQueueNumber(appointmentCategoryId) {
    const lastQueueEntry = await db.collection('queue')
        .find({ appointmentCategoryId: new ObjectId(appointmentCategoryId) })
        .sort({ number: -1 })
        .limit(1)
        .toArray();

    if (lastQueueEntry.length > 0) {
        return lastQueueEntry[0].number + 1;
    }
    return 1;
}

// --- Staff Use Cases ---

// Use Case: Update queueing number (Call next customer) by customerId
// Endpoint: /staff/queue/next/customer/:customerId
// Method: PATCH
// Status Codes: 200 OK, 404 Not Found
app.patch('/staff/queue/next/customer/:customerId', async (req, res) => {
    try {
        const { customerId } = req.params;
        if (!ObjectId.isValid(customerId)) {
            return res.status(400).json({ error: "Invalid customer ID" });
        }

        const result = await db.collection('queue').findOneAndUpdate(
            { customerId: new ObjectId(customerId), served: false },
            { $set: { served: true, servedAt: new Date() } },
            { sort: { number: 1 }, returnDocument: 'after' }
        );

        if (result) {
            if (result.value) {
                res.status(200).json({ message: `Calling queue number ${result.value.number} for customer ${customerId}` });
            } else {
                // If 'returnDocument: 'after'' didn't provide the value, fetch it again
                const updatedQueueEntry = await db.collection('queue').findOne({
                    customerId: new ObjectId(customerId),
                    served: true // It should now be served
                });

                if (updatedQueueEntry) {
                    res.status(200).json({ message: `Calling queue number ${updatedQueueEntry.number} for customer ${customerId}` });
                } else {
                    console.warn("findOneAndUpdate succeeded but couldn't retrieve updated document.");
                    res.status(500).json({ error: "Failed to retrieve updated queue information." });
                }
            }
        } else {
            res.status(404).json({ message: `No pending queue entry found for customer ${customerId}` });
        }
    } catch (err) {
        console.error("Error updating queue by customer ID:", err);
        res.status(500).json({ error: "Failed to update queue" });
    }
});

// Use Case: Cancel queue entry by customerId and appointmentCategoryId
// Endpoint: /staff/queue/cancel/customer/:customerId/:appointmentCategoryId
// Method: DELETE
// Status Codes: 204 No Content, 404 Not Found, 400 Bad Request
app.delete('/staff/queue/cancel/customer/:customerId/:appointmentCategoryId', async (req, res) => {
    try {
        const { customerId, appointmentCategoryId } = req.params;

        if (!ObjectId.isValid(customerId) || !ObjectId.isValid(appointmentCategoryId)) {
            return res.status(400).json({ error: "Invalid customer ID or appointment category ID" });
        }

        const result = await db.collection('queue').deleteOne({
            customerId: new ObjectId(customerId),
            appointmentCategoryId: new ObjectId(appointmentCategoryId)
        });

        if (result.deletedCount > 0) {
            res.status(204).send();
        } else {
            res.status(404).json({ error: `No queue entry found for customer ${customerId} in category ${appointmentCategoryId}` });
        }
    } catch (err) {
        console.error("Error cancelling queue entry by customer ID:", err);
        res.status(400).json({ error: "Invalid request" });
    }
});

// Use Case: Update branch availability
// Endpoint: /staff/location/:locationId
// Method: PATCH
// Request Body: { availability: "..." }
// Status Codes: 200 OK, 400 Bad Request, 404 Not Found
app.patch('/staff/location/:locationId', async (req, res) => {
    try {
        if (!ObjectId.isValid(req.params.locationId)) {
            return res.status(400).json({ error: "Invalid location ID" });
        }
        const result = await db.collection('locations').updateOne(
            { _id: new ObjectId(req.params.locationId) },
            { $set: { availability: req.body.availability } }
        );

        if (result.modifiedCount === 0) {
            return res.status(404).json({ error: "Location not found" });
        }
        res.status(200).json({ updated: result.modifiedCount });

    } catch (err) {
        console.error("Error updating location:", err);
        res.status(400).json({ error: "Invalid location ID or data" });
    }
});

// --- Admin Use Cases ---

// Use Case: Arrange appointment categories
// Endpoint: /admin/categories
// Method: POST
// Status Codes: 201 Created, 400 Bad Request, 500 Internal Server Error
app.post('/admin/categories', async (req, res) => {
    try {
        const result = await db.collection('categories').insertOne(req.body);
        res.status(201).json({ appointmentCategoryId: result.insertedId });
    } catch (err) {
        console.error("Error adding category:", err);
        res.status(400).json({ error: "Invalid category data" });
    }
});

// Use Case: Fetch branch locations
// Endpoint: /admin/locations
// Method: GET
// Status Codes: 200 OK, 500 Internal Server Error
app.get('/admin/locations', async (req, res) => {
    try {
        const locations = await db.collection('locations').find().toArray();
        res.status(200).json(locations);
    } catch (err) {
        console.error("Error fetching locations:", err);
        res.status(500).json({ error: "Failed to fetch locations" });
    }
});

// Use Case: Manages branch information
// Endpoint: /admin/locations
// Method: POST
// Request Body: { location: "...", hours: "...", availability: "..." }
// Status Codes: 201 Created, 400 Bad Request, 500 Internal Server Error
app.post('/admin/locations', async (req, res) => {
    try {
        const result = await db.collection('locations').insertOne(req.body);
        res.status(201).json({ message: 'Location added successfully', locationId: result.insertedId });
    } catch (err) {
        console.error("Error adding location:", err);
        res.status(400).json({ error: "Invalid location data" });
    }
});

// Use Case: Manages customer accounts
// Endpoint: /admin/customers
// Method: GET
// Status Codes: 200 OK, 500 Internal Server Error
app.get('/admin/customers', async (req, res) => {
    try {
        const customers = await db.collection('customers').find({}, { projection: { password: 0 } }).toArray();
        res.status(200).json(customers);
    } catch (err) {
        console.error("Error fetching customers:", err);
        res.status(500).json({ error: "Failed to fetch customer accounts" });
    }
});

// Endpoint: /admin/customers/:id
// Method: DELETE
// Status Codes: 204 No Content, 404 Not Found, 400 Bad Request
app.delete('/admin/customers/:id', async (req, res) => {
    try {
        const customerId = req.params.id;
        if (!ObjectId.isValid(customerId)) {
            return res.status(400).json({ error: "Invalid customer ID" });
        }
        const result = await db.collection('customers').deleteOne({ _id: new ObjectId(customerId) });

        if (result.deletedCount > 0) {
            res.status(204).send();
        } else {
            res.status(404).json({ error: "Customer not found" });
        }
    } catch (err) {
        console.error("Error deleting customer:", err);
        res.status(400).json({ error: "Invalid customer ID" });
    }
});

// Use Case: Generates system-wide reports
// Endpoint: /admin/reports
// Method: GET
// Status Codes: 200 OK, 500 Internal Server Error
app.get('/admin/reports', async (req, res) => {
    try {
        const totalCustomers = await db.collection('customers').countDocuments();
        const totalQueueEntries = await db.collection('queue').countDocuments();
        const activeQueueEntries = await db.collection('queue').countDocuments({ served: false });

        res.status(200).json({
            totalCustomers,
            totalQueueEntries,
            activeQueueEntries
        });
    } catch (err) {
        console.error("Error generating system reports:", err);
        res.status(500).json({ error: "Failed to generate system reports" });
    }
});