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

        db = client.db("MyTaxiDB"); 
    } catch (err) {
        console.error("Failed to connect to MongoDB:", err);
    }
}
connectToMongoDB();

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});

// --- Customer Use Cases ---

// Use Case: Register
// Endpoint: /customer/register
// Method: POST
app.post('/customer/register', async (req, res) => {
    try {
        const { username, password, email, phone_no } = req.body;
        if (!username || !email || !password || !phone_no) {
            return res.status(400).json({ message: 'All fields are required for registration.' });
        }

        const existingCustomer = await db.collection('customers').findOne({ email });
        if (existingCustomer) {
            return res.status(409).json({ message: 'Customer with this email already exists.' });
        }

        const result = await db.collection('customers').insertOne({ username, password, email, phone_no, joined_date: new Date() });
        res.status(201).json({ message: 'Registration successful', customerId: result.insertedId });
    } catch (err) {
        console.error("Error registering customer:", err);
        res.status(400).json({ error: "Invalid registration data" });
    }
});

// Use Case: Login
// Endpoint: /customer/login
// Method: GET
app.get('/customer/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const customer = await db.collection('customers').findOne({ email, password });
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

// Use Case: Manage Profile (Fetch Account)
// Endpoint: /customer/:customerId
// Method: GET
app.get('/customer/:customerId', async (req, res) => {
    try {
        const customerId = req.params.customerId;
        const customer = await db.collection('customers').findOne({ _id: new ObjectId(customerId) });
        if (customer) {
            // Exclude sensitive information like password
            const { Password, ...customerData } = customer; 
            res.status(200).json(customerData);
        } else {
            res.status(404).json({ message: 'Customer not found' });
        }
    } catch (error) {
        console.error("Error fetching customer profile:", error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Use Case: Manage Profile (Update Profile)
// Endpoint: /customer/:customerId
// Method: PATCH
app.patch('/customer/:customerId', async (req, res) => {
    try {
        const customerId = req.params.customerId;
        const updateData = req.body;
        // Prevent direct updates to _id, joined_date, etc. if not intended
        delete updateData._id; 
        delete updateData.joined_date;

        const result = await db.collection('customers').updateOne(
            { _id: new ObjectId(customerId) },
            { $set: updateData }
        );
        if (result.matchedCount > 0) {
            res.status(200).json({ message: 'Customer profile updated successfully' });
        } else {
            res.status(404).json({ message: 'Customer not found' });
        }
    } catch (error) {
        console.error("Error updating customer profile:", error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Use Case: Book Ride
// Endpoint: /ride/book
// Method: POST
app.post('/ride/book', async (req, res) => {
    try {
        const { customerId, PickupLocation, Destination } = req.body;
        if (!customerId || !PickupLocation || !Destination) {
            return res.status(400).json({ message: 'Customer ID, Pickup Location, and Destination are required.' });
        }

        // Simulate finding a driver and calculating fare (simplified)
        const availableDriver = await db.collection('drivers').findOne({ Status: 'Available' });
        if (!availableDriver) {
            return res.status(503).json({ message: 'No drivers available at the moment.' });
        }

        const fare = Math.random() * 50 + 10; // Random fare for demonstration

        const rideData = {
            customerId: new ObjectId(customerId),
            driverId: availableDriver._id,
            PickupLocation,
            Destination,
            Status: 'Pending', // e.g., Pending, Accepted, Started, Completed, Cancelled
            paymentStatus: null, // Will be updated after payment
            Fare: fare.toFixed(2),
            BookingTime: new Date()
        };
        const result = await db.collection('rides').insertOne(rideData);

        // Update driver status
        await db.collection('drivers').updateOne(
            { _id: availableDriver._id },
            { $set: { Status: 'On Trip' } }
        );
        
        res.status(201).json({ message: 'Ride booked successfully', rideId: result.insertedId, fare });
    } catch (error) {
        console.error("Error booking ride:", error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Use Case: Cancel Ride
// Endpoint: /ride/cancel/:rideId
// Method: PATCH
app.patch('/ride/cancel/:rideId', async (req, res) => {
    try {
        const rideId = req.params.rideId;
        const ride = await db.collection('rides').findOne({ _id: new ObjectId(rideId) });

        if (!ride) {
            return res.status(404).json({ message: 'Ride not found.' });
        }
        
        if (ride.Status === 'Completed' || ride.Status === 'Cancelled') {
            return res.status(400).json({ message: 'Cannot cancel a completed or already cancelled ride.' });
        }

        const result = await db.collection('rides').updateOne(
            { _id: new ObjectId(rideId) },
            { $set: { Status: 'Cancelled' } }
        );

        // Optionally, update driver status back to 'Available' if the ride was accepted
        if (ride.Status === 'Accepted' || ride.Status === 'Pending' && ride.driverId) {
             await db.collection('drivers').updateOne(
                { _id: ride.driverId },
                { $set: { Status: 'Available' } }
            );
        }

        res.status(200).json({ message: 'Ride cancelled successfully' });
    } catch (error) {
        console.error("Error cancelling ride:", error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Use Case: View Ride History
// Endpoint: /ride/:id
// Method: GET
app.get('/ride/:id', async (req, res) => {
    try {
        const customerId = req.params.id;
        const rides = await db.collection('rides').find({ customerId: new ObjectId(customerId) }).toArray();
        res.status(200).json(rides);
    } catch (error) {
        console.error("Error fetching customer ride history:", error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Use Case: Give Rating
// Endpoint: /rating
// Method: POST
app.post('/rating', async (req, res) => {
    try {
        const { customerId, driverId, rideId, rating } = req.body;
        if (!customerId || !driverId || !rideId || !rating) {
            return res.status(400).json({ message: 'Customer ID, Driver ID, Ride ID, and Rating are required.' });
        }
        if (rating < 1 || rating > 5) {
            return res.status(400).json({ message: 'Rating must be between 1 and 5.' });
        }

        const result = await db.collection('ratings').insertOne({
            customerId: new ObjectId(customerId),
            driverId: new ObjectId(driverId),
            rideId: new ObjectId(rideId),
            rating
        });

        // Update driver's average rating (simplified)
        const driverRatings = await db.collection('ratings').find({ driverId: new ObjectId(driverId) }).toArray();
        const totalRating = driverRatings.reduce((sum, r) => sum + r.rating, 0);
        const averageRating = totalRating / driverRatings.length;

        await db.collection('drivers').updateOne(
            { _id: new ObjectId(driverId) },
            { $set: { Rating: averageRating.toFixed(2) } }
        );

        res.status(201).json({ message: 'Rating submitted successfully', ratingId: result.insertedId });
    } catch (error) {
        console.error("Error submitting rating:", error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Use Case: Make Payment
// Endpoint: /payment
// Method: POST
app.post('/payment', async (req, res) => {
    try {
        const { rideId, Fare, driverId } = req.body;
        if (!rideId || !Fare || !driverId) {
            return res.status(400).json({ message: 'Ride ID, Fare, and Driver ID are required for payment.' });
        }

        const result = await db.collection('payments').insertOne({
            rideId: new ObjectId(rideId),
            Fare: Fare,
            driverId: new ObjectId(driverId),
            Payment_Time: new Date(),
            Status: 'Completed' // e.g., Pending, Completed, Failed
        });

        // Update ride status to paid and link payment
        await db.collection('rides').updateOne(
            { _id: new ObjectId(rideId) },
            { $set: { Status: 'Completed', paymentId: result.insertedId, paymentStatus: 'Paid' } }
        );

        // Update driver earnings
        await db.collection('drivers').updateOne(
            { _id: new ObjectId(driverId) },
            { $inc: { Earnings: Fare } } // Increment earnings
        );

        res.status(201).json({ message: 'Payment processed successfully', paymentId: result.insertedId });
    } catch (error) {
        console.error("Error processing payment:", error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// --- Driver Use Cases ---

// Use Case: Register
// Endpoint: /driver/register
// Method: POST
app.post('/driver/register', async (req, res) => {
    try {
        const { username, email, phone_no, car_model, password } = req.body;
        if (!username || !email || !phone_no || !car_model || !password) {
            return res.status(400).json({ message: 'All fields are required for driver registration.' });
        }

        const driversCollection = db.collection('drivers');
        const existingDriver = await driversCollection.findOne({ email });
        if (existingDriver) {
            return res.status(409).json({ message: 'Driver with this email already exists.' });
        }

        const result = await driversCollection.insertOne({
            username,
            email,
            phone_no,
            car_model,
            password, // In a real app, hash this password!
            joined_date: new Date(),
            Status: 'Available', // Available, On Trip, Offline
            Earnings: 0
        });
        res.status(201).json({ message: 'Driver registered successfully', driverId: result.insertedId });
    } catch (error) {
        console.error("Error registering driver:", error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Use Case: Login
// Endpoint: /driver/login
// Method: GET
app.get('/driver/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const driver = await db.collection('drivers').findOne({ email, password }); // Hashed password check in real app
        if (driver) {
            res.status(200).json({ message: 'Driver login successful', driverId: driver._id });
        } else {
            res.status(401).json({ message: 'Invalid credentials' });
        }
    } catch (error) {
        console.error("Error logging in driver:", error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Use Case: Manage Profile (Fetch Account)
// Endpoint: /driver/:driverId
// Method: GET
app.get('/driver/:driverId', async (req, res) => {
    try {
        const driverId = req.params.driverId;
        const driver = await db.collection('drivers').findOne({ _id: new ObjectId(driverId) });
        if (driver) {
            // Exclude sensitive information like password
            const { Password, ...driverData } = driver; 
            res.status(200).json(driverData);
        } else {
            res.status(404).json({ message: 'Customer not found' });
        }
    } catch (error) {
        console.error("Error fetching customer profile:", error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Use Case: Manage Profile (Update Profile)
// Endpoint: /driver/:driverId
// Method: PATCH
app.patch('/driver/:driverId', async (req, res) => {
    try {
        const driverId = req.params.driverId;
        const updateData = req.body;
        // Prevent direct updates to _id, joined_date, etc. if not intended
        delete updateData._id; 
        delete updateData.joined_date;

        const result = await db.collection('drivers').updateOne(
            { _id: new ObjectId(driverId) },
            { $set: updateData }
        );
        if (result.matchedCount > 0) {
            res.status(200).json({ message: 'Customer profile updated successfully' });
        } else {
            res.status(404).json({ message: 'Customer not found' });
        }
    } catch (error) {
        console.error("Error updating customer profile:", error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Use Case: Accept Ride
// Endpoint: /ride/accept/:rideId
// Method: PATCH
app.patch('/ride/accept/:rideId', async (req, res) => {
    try {
        const rideId = req.params.rideId;
        const { driverId } = req.body; // Driver accepting the ride
        if (!driverId) {
            return res.status(400).json({ message: 'Driver ID is required to accept a ride.' });
        }

        const ride = await db.collection('rides').findOne({ _id: new ObjectId(rideId) });
        if (!ride) {
            return res.status(404).json({ message: 'Ride not found.' });
        }
        if (ride.Status !== 'Pending') {
            return res.status(400).json({ message: 'Ride is not in a pending state and cannot be accepted.' });
        }

        const result = await db.collection('rides').updateOne(
            { _id: new ObjectId(rideId), Status: 'Pending' }, // Ensure only pending rides are accepted
            { $set: { Status: 'Accepted', driverId: new ObjectId(driverId) } }
        );

        if (result.matchedCount > 0) {
            // Update driver status
            await db.collection('drivers').updateOne(
                { _id: new ObjectId(driverId) },
                { $set: { Status: 'On Trip' } }
            );
            res.status(200).json({ message: 'Ride accepted successfully' });
        } else {
            res.status(400).json({ message: 'Ride could not be accepted (already accepted or not pending).' });
        }
    } catch (error) {
        console.error("Error accepting ride:", error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Use Case: Cancel Ride
// Endpoint: /ride/cancel/:rideId
// Method: PATCH
app.patch('/ride/cancel/:rideId', async (req, res) => {
    try {
        const rideId = req.params.rideId;
        const { driverId } = req.body; // Driver attempting to cancel the ride

        if (!driverId) {
            return res.status(400).json({ message: 'Driver ID is required to cancel a ride.' });
        }

        const ride = await db.collection('rides').findOne({ _id: new ObjectId(rideId) });

        if (!ride) {
            return res.status(404).json({ message: 'Ride not found.' });
        }

        // Ensure the driver attempting to cancel is the one assigned to the ride
        // or add logic to allow any driver to cancel unassigned rides if applicable
        if (ride.driverId && ride.driverId.toString() !== driverId) {
             return res.status(403).json({ message: 'You are not authorized to cancel this ride.' });
        }
        
        if (ride.Status === 'Completed' || ride.Status === 'Cancelled') {
            return res.status(400).json({ message: 'Ride is already completed or cancelled and cannot be cancelled again.' });
        }

        const result = await db.collection('rides').updateOne(
            { _id: new ObjectId(rideId) },
            { $set: { Status: 'Cancelled' } }
        );

        if (result.matchedCount > 0) {
            // If the driver who cancelled was assigned, update their status back to 'Available'
            if (ride.driverId && ride.driverId.toString() === driverId) {
                await db.collection('drivers').updateOne(
                    { _id: new ObjectId(driverId) },
                    { $set: { Status: 'Available' } }
                );
            }
            res.status(200).json({ message: 'Ride cancelled successfully by driver.' });
        } else {
            res.status(400).json({ message: 'Failed to cancel ride.' });
        }
    } catch (error) {
        console.error("Error cancelling ride by driver:", error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Use Case: Update Driver Availability
// Endpoint: /driver/update/:driverId
// Method: PATCH
app.patch('/driver/update/:driverId', async (req, res) => {
    try {
        const driverId = req.params.driverId;
        const { status } = req.body; // e.g., 'Available', 'Offline', 'On Trip'

        if (!status || !['Available', 'Offline', 'On Trip'].includes(status)) {
            return res.status(400).json({ message: 'Invalid status provided. Must be Available, Offline, or On Trip.' });
        }

        const result = await db.collection('drivers').updateOne(
            { _id: new ObjectId(driverId) },
            { $set: { Status: status } }
        );
        if (result.matchedCount > 0) {
            res.status(200).json({ message: `Driver availability updated to ${status}` });
        } else {
            res.status(404).json({ message: 'Driver not found' });
        }
    } catch (error) {
        console.error("Error updating driver availability:", error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Use Case: View Driver Rating
// Endpoint: /rating/:driverId
// Method: GET
app.get('/rating/:driverId', async (req, res) => {
    try {
        const driverId = req.params.driverId;
        const driver = await db.collection('ratings').findOne({ driverId: new ObjectId(driverId) }, { projection: { rating: 1 } });
        if (driver) {
            res.status(200).json({ rating: driver.rating || 0 });
        } else {
            res.status(404).json({ message: 'Driver not found' });
        }
    } catch (error) {
        console.error("Error fetching driver rating:", error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Use Case: View Driver Earnings
// Endpoint: /driver/earnings/:id
// Method: GET
app.get('/driver/earnings/:id', async (req, res) => {
    try {
        const driverId = req.params.id;
        const driver = await db.collection('drivers').findOne({ _id: new ObjectId(driverId) }, { projection: { Earnings: 1 } });
        if (driver) {
            res.status(200).json({ earnings: driver.Earnings || 0 });
        } else {
            res.status(404).json({ message: 'Driver not found' });
        }
    } catch (error) {
        console.error("Error fetching driver earnings:", error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// --- Admin Use Cases ---

// Use Case: Login
// Endpoint: /admin/login
// Method: POST
app.post('/admin/login', async (req, res) => {
    try {
        const { adminId, password } = req.body; // Assuming a simple adminId/password for now
        // In a real app, you'd have proper admin user management and authentication
        if (adminId === 'admin' && password === 'adminpass') { // Placeholder
            res.status(200).json({ message: 'Admin login successful' });
        } else {
            res.status(401).json({ message: 'Invalid admin credentials' });
        }
    } catch (error) {
        console.error("Error logging in admin:", error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Use Case: Fetch All Users
// Endpoint: /admin/users
// Method: GET
app.get('/admin/users', async (req, res) => {
    try {
        const customers = await db.collection('customers').find({}).project({ Password: 0 }).toArray(); // Exclude passwords
        const drivers = await db.collection('drivers').find({}).project({ Password: 0 }).toArray(); // Exclude passwords
        res.status(200).json({ customers, drivers });
    } catch (error) {
        console.error("Error fetching all users (admin):", error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Use Case: Block Users
// Endpoint: /admin/block/:type/:id
// Method: PATCH
app.patch('/admin/block/:type/:id', async (req, res) => {
    try {
        const { type, id } = req.params; // type can be 'customer' or 'driver'
        let collection;
        if (type === 'customer') {
            collection = db.collection('customers');
        } else if (type === 'driver') {
            collection = db.collection('drivers');
        } else {
            return res.status(400).json({ message: 'Invalid user type. Must be "customer" or "driver".' });
        }

        const result = await collection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { IsBlocked: true, Status: 'Blocked' } } // Add a 'IsBlocked' flag
        );
        if (result.matchedCount > 0) {
            res.status(200).json({ message: `${type} with ID ${id} blocked successfully.` });
        } else {
            res.status(404).json({ message: `${type} not found.` });
        }
    } catch (error) {
        console.error("Error blocking user (admin):", error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Use Case: Generate Reports
// Endpoint: /admin/reports
// Method: GET
app.get('/admin/reports', async (req, res) => {
    try {
        // You would typically have a more sophisticated reporting system,
        // but this is a basic example based on the ERD.

        // Aggregate total rides and total payments per month
        const monthlyReports = await db.collection('rides').aggregate([
            {
                $match: {
                    Status: 'Completed' // Only count completed rides for reports
                }
            },
            {
                $group: {
                    _id: {
                        month: { $month: "$BookingTime" },
                        year: { $year: "$BookingTime" }
                    },
                    Total_Rides: { $sum: 1 },
                    Total_Payments_Made: { $sum: "$Fare" }
                }
            },
            {
                $sort: { "_id.year": 1, "_id.month": 1 }
            }
        ]).toArray();

        // Convert month numbers to names for better readability
        const formattedReports = monthlyReports.map(report => {
            const date = new Date(report._id.year, report._id.month - 1); // Month is 0-indexed in JS Date
            const monthName = date.toLocaleString('default', { month: 'long' });
            return {
                Month: `${monthName} ${report._id.year}`,
                Total_Rides: report.Total_Rides,
                Total_Payments_Made: report.Total_Payments_Made.toFixed(2)
            };
        });

        res.status(200).json(formattedReports);
    } catch (error) {
        console.error("Error generating reports (admin):", error);
        res.status(500).json({ message: 'Internal server error' });
    }
});