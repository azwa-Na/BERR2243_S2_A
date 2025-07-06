require('dotenv').config();

const express = require('express');
const { MongoClient } = require('mongodb');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

let db;

const JWT_SECRET = process.env.JWT_SECRET || 

async function connectToMongoDB() {
    const uri = process.env.MONGO_URI || "mongodb://localhost:27017";
    const client = new MongoClient(uri, { useUnifiedTopology: true });

    try {
        await client.connect();
        console.log("Connected to MongoDB!");
        db = client.db("MyTaxiDB");

        await db.collection('customers').createIndex({ email: 1 }, { unique: true });
        await db.collection('drivers').createIndex({ email: 1 }, { unique: true });
        console.log("Collections and indexes ensured.");
    } catch (err) {
        console.error("Failed to connect to MongoDB:", err);
        process.exit(1);
    }
}

connectToMongoDB();

app.get('/', (req, res) => {
    res.send('Hello World!');
});

// --- Middleware Functions for Authentication and Authorization ---

// Middleware to authenticate JWT token
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Expects format: "Bearer TOKEN"

    if (token == null) {
        return res.status(401).json({ message: 'Authentication token required.' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            console.error("JWT verification error:", err);
            // If token is invalid or expired, return 403 Forbidden
            return res.status(403).json({ message: 'Invalid or expired token.' });
        }
        req.user = user; // Attach decoded user payload (id, role) to the request
        next(); // Proceed to the next middleware/route handler
    });
}

// Middleware for Role-Based Access Control (RBAC)
function authorizeRoles(roles) {
    return (req, res, next) => {
        // req.user must be set by authenticateToken first
        if (!req.user || !roles.includes(req.user.role)) {
            return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
        }
        next(); // User has required role, proceed
    };
}

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

        const customersCollection = db.collection('customers');
        const existingCustomer = await db.collection('customers').findOne({ email });
        if (existingCustomer) {
            return res.status(409).json({ message: 'Customer with this email already exists.' });
        }

        // Hash the password before storing
        const hashedPassword = await bcrypt.hash(password, 10); // 10 is the salt rounds

        const result = await customersCollection.insertOne({
            username,
            password: hashedPassword, // Store hashed password
            email,
            phone_no,
            joined_date: new Date(),
            role: 'customer' // Assign role
        });
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
        const customer = await db.collection('customers').findOne({ email });
        
        if (!customer) {
            return res.status(401).json({ message: 'Invalid email or password.' });
        }

        // Compare provided password with stored hashed password
        const isPasswordValid = await bcrypt.compare(password, customer.password);
        if (!isPasswordValid) {
            return res.status(401).json({ message: 'Invalid email or password.' });
        }

        // Generate JWT upon successful login
        const token = jwt.sign(
            { id: customer._id.toString(), role: customer.role }, // Ensure id is string
            JWT_SECRET,
            { expiresIn: '1h' } // Token expires in 1 hour
        );
        res.status(200).json({ message: 'Login successful', token, customerId: customer._id, role: customer.role });
    } catch (err) {
        console.error("Error during login:", err);
        res.status(500).json({ error: "Login failed" });
    }
});

// Use Case: Manage Profile (Update Profile)
// Endpoint: /customer/:customerId
// Method: PATCH
app.patch('/customer/:customerId', authenticateToken, authorizeRoles(['customer', 'admin']), async (req, res) => {
    try {
        const customerId = req.params.customerId;

        // Data Ownership Check: Customer can only update their own profile, unless they are an admin
        if (req.user.role === 'customer' && req.user.id !== customerId) {
            return res.status(403).json({ message: 'Access denied. You can only update your own profile.' });
        }

        const updateData = req.body;
        // Prevent direct updates to _id, joined_date, role, and password (password handled separately)
        delete updateData._id; 
        delete updateData.joined_date;
        delete updateData.role; 
        if (updateData.password) {
            updateData.password = await bcrypt.hash(updateData.password, 10); // Re-hash new password if provided
        }

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
app.post('/ride/book', authenticateToken, authorizeRoles(['customer']), async (req, res) => {
    try {
        // Customer ID is taken from the authenticated user's JWT
        const customerId = req.user.id; 
        const { PickupLocation, Destination } = req.body;
        if (!PickupLocation || !Destination) {
            return res.status(400).json({ message: 'Pickup Location and Destination are required.' });
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
            paymentStatus: 'Pending', // Initial payment status
            Fare: fare.toFixed(2),
            BookingTime: new Date()
        };
        const result = await db.collection('rides').insertOne(rideData);

        // Update driver status to 'On Trip' (assuming they accept immediately)
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
app.patch('/ride/cancel/:rideId', authenticateToken, authorizeRoles(['customer']), async (req, res) => {
    try {
        const rideId = req.params.rideId;
        const customerId = req.user.id; // Customer ID from authenticated user

        const ride = await db.collection('rides').findOne({ _id: new ObjectId(rideId) });

        if (!ride) {
            return res.status(404).json({ message: 'Ride not found.' });
        }
        
        // Data Ownership Check: Ensure customer is cancelling their own ride
        if (ride.customerId.toString() !== customerId) {
            return res.status(403).json({ message: 'Access denied. You can only cancel your own rides.' });
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

// Use Case: View Ride History (Customer)
// Endpoint: /customer/rides
// Method: GET (Changed endpoint to be more generic for customer's own rides)
app.get('/customer/rides', authenticateToken, authorizeRoles(['customer']), async (req, res) => {
    try {
        const customerId = req.user.id; // Customer ID from authenticated user
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
app.post('/rating', authenticateToken, authorizeRoles(['customer']), async (req, res) => {
    try {
        const customerId = req.user.id; // Customer ID from authenticated user
        const { driverId, rideId, rating } = req.body; // driverId and rideId should be provided by frontend
        if (!driverId || !rideId || !rating) {
            return res.status(400).json({ message: 'Driver ID, Ride ID, and Rating are required.' });
        }
        if (rating < 1 || rating > 5) {
            return res.status(400).json({ message: 'Rating must be between 1 and 5.' });
        }

        const result = await db.collection('ratings').insertOne({
            customerId: new ObjectId(customerId),
            driverId: new ObjectId(driverId),
            rideId: new ObjectId(rideId),
            rating,
            timestamp: new Date()
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
app.post('/payment', authenticateToken, authorizeRoles(['customer']), async (req, res) => {
    try {
        // Customer ID from authenticated user
        const customerId = req.user.id; 
        const { rideId, amount, driverId } = req.body;
        if (!rideId || !amount || !driverId) {
            return res.status(400).json({ message: 'Ride ID, Amount, and Driver ID are required for payment.' });
        }

        const result = await db.collection('payments').insertOne({
            rideId: new ObjectId(rideId),
            Fare: amount,
            driverId: new ObjectId(driverId),
            Payment_Time: new Date(),
            Status: 'Completed' 
        });

        // Update ride status to completed, link payment, and set paymentStatus
        await db.collection('rides').updateOne(
            { _id: new ObjectId(rideId) },
            { $set: { Status: 'Completed', paymentId: result.insertedId, paymentStatus: 'Paid' } }
        );

        // Update driver earnings
        await db.collection('drivers').updateOne(
            { _id: new ObjectId(driverId) },
            { $inc: { Earnings: amount } } // Increment earnings
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

        // Hash the password before storing
        const hashedPassword = await bcrypt.hash(password, 10);

        const result = await driversCollection.insertOne({
            username,
            email,
            phone_no,
            car_model,
            password: hashedPassword, // Store hashed password
            joined_date: new Date(),
            Status: 'Available', // Available, On Trip, Offline
            Earnings: 0,
            role: 'driver' // Assign role
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
        if (!driver) {
            return res.status(401).json({ message: 'Invalid email or password.' });
        }

        // Compare provided password with stored hashed password
        const isPasswordValid = await bcrypt.compare(password, driver.password);
        if (!isPasswordValid) {
            return res.status(401).json({ message: 'Invalid email or password.' });
        }

        // Generate JWT upon successful login
        const token = jwt.sign(
            { id: driver._id.toString(), role: driver.role }, // Ensure id is string
            JWT_SECRET,
            { expiresIn: '1h' }
        );
        res.status(200).json({ message: 'Driver login successful', token, driverId: driver._id, role: driver.role });
    } catch (error) {
        console.error("Error logging in driver:", error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Use Case: Manage Profile (Update Profile)
// Endpoint: /driver/:driverId
// Method: PATCH
app.patch('/driver/:driverId', authenticateToken, authorizeRoles(['driver', 'admin']), async (req, res) => {
    try {
        const driverId = req.params.driverId;

        // Data Ownership Check: Driver can only update their own profile, unless they are an admin
        if (req.user.role === 'driver' && req.user.id !== driverId) {
            return res.status(403).json({ message: 'Access denied. You can only update your own profile.' });
        }

        const updateData = req.body;
        // Prevent direct updates to _id, joined_date, role, and password (password handled separately)
        delete updateData._id; 
        delete updateData.joined_date;
        delete updateData.role; 
        if (updateData.password) {
            updateData.password = await bcrypt.hash(updateData.password, 10); // Re-hash new password if provided
        }

        const result = await db.collection('drivers').updateOne(
            { _id: new ObjectId(driverId) },
            { $set: updateData }
        );
        if (result.matchedCount > 0) {
            res.status(200).json({ message: 'Driver profile updated successfully' });
        } else {
            res.status(404).json({ message: 'Driver not found' });
        }
    } catch (error) {
        console.error("Error updating driver profile:", error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Use Case: Accept Ride
// Endpoint: /ride/accept/:rideId
// Method: PATCH
app.patch('/ride/accept/:rideId', authenticateToken, authorizeRoles(['driver']), async (req, res) => {
    try {
        const rideId = req.params.rideId;
        const driverId = req.user.id; // Driver ID from authenticated user

        const ride = await db.collection('rides').findOne({ _id: new ObjectId(rideId) });
        if (!ride) {
            return res.status(404).json({ message: 'Ride not found.' });
        }
        if (ride.Status !== 'Pending') {
            return res.status(400).json({ message: 'Ride is not in a pending state and cannot be accepted.' });
        }

        // Check if the driver is already 'On Trip' and prevent them from accepting another ride
        const currentDriver = await db.collection('drivers').findOne({ _id: new ObjectId(driverId) });
        if (currentDriver && currentDriver.Status === 'On Trip') {
            return res.status(400).json({ message: 'You are currently on a trip and cannot accept new rides.' });
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

// Use Case: Cancel Ride (Driver)
// Endpoint: /driver/cancel-ride/:rideId
// Method: PATCH
app.patch('/driver/cancel-ride/:rideId', authenticateToken, authorizeRoles(['driver']), async (req, res) => {
    try {
        const rideId = req.params.rideId;
        const driverId = req.user.id; // Driver ID from authenticated user

        const ride = await db.collection('rides').findOne({ _id: new ObjectId(rideId) });

        if (!ride) {
            return res.status(404).json({ message: 'Ride not found.' });
        }

        // Data Ownership Check: Ensure the driver attempting to cancel is the one assigned to the ride
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
// Endpoint: /driver/:driverId/availability (changed from /driver/:driverId to differentiate from profile update)
// Method: PATCH
app.patch('/driver/:driverId/availability', authenticateToken, authorizeRoles(['driver']), async (req, res) => {
    try {
        const driverId = req.params.driverId;

        // Data Ownership Check: Driver can only update their own availability
        if (req.user.id !== driverId) {
            return res.status(403).json({ message: 'Access denied. You can only update your own availability.' });
        }

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
// Endpoint: /driver/rating/:driverId (changed from /rating/:driverId for consistency)
// Method: GET
app.get('/driver/rating/:driverId', authenticateToken, authorizeRoles(['customer', 'driver', 'admin']), async (req, res) => {
    try {
        const driverId = req.params.driverId;

        // Optional: If you want to restrict drivers to only view their own rating
        // if (req.user.role === 'driver' && req.user.id !== driverId) {
        //     return res.status(403).json({ message: 'Access denied. You can only view your own rating.' });
        // }

        const driver = await db.collection('drivers').findOne({ _id: new ObjectId(driverId) }, { projection: { Rating: 1 } });
        if (driver) {
            res.status(200).json({ rating: driver.Rating || 0 });
        } else {
            res.status(404).json({ message: 'Driver not found' });
        }
    } catch (error) {
        console.error("Error fetching driver rating:", error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Use Case: View Driver Earnings
// Endpoint: /driver/earnings/:driverId (changed from /driver/earnings/:id)
// Method: GET
app.get('/driver/earnings/:driverId', authenticateToken, authorizeRoles(['driver', 'admin']), async (req, res) => {
    try {
        const driverId = req.params.driverId;

        // Data Ownership Check: Driver can only view their own earnings, unless they are an admin
        if (req.user.role === 'driver' && req.user.id !== driverId) {
            return res.status(403).json({ message: 'Access denied. You can only view your own earnings.' });
        }

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

// Use Case: Register Admin
// Endpoint: /admin/register
// Method: POST
app.post('/admin/register', async (req, res) => {
    try {
        const { username, password, email } = req.body;
        if (!username || !email || !password) {
            return res.status(400).json({ message: 'All fields are required for admin registration.' });
        }

        const adminsCollection = db.collection('admins');
        const existingAdmin = await adminsCollection.findOne({ email });
        if (existingAdmin) {
            return res.status(409).json({ message: 'Admin with this email already exists.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const result = await adminsCollection.insertOne({
            username,
            password: hashedPassword,
            email,
            joined_date: new Date(),
            role: 'admin'
        });
        res.status(201).json({ message: 'Admin registered successfully', adminId: result.insertedId });
    } catch (err) {
        console.error("Error registering admin:", err);
        res.status(500).json({ error: "Server error during admin registration" });
    }
});

// Use Case: Login Admin
// Endpoint: /admin/login
// Method: POST
app.post('/admin/login', async (req, res) => {
    try {
        const { email, password } = req.body; 

        const admin = await db.collection('admins').findOne({ email });
        if (!admin) {
            return res.status(401).json({ message: 'Invalid email or password.' });
        }

        const isPasswordValid = await bcrypt.compare(password, admin.password);
        if (!isPasswordValid) {
            return res.status(401).json({ message: 'Invalid email or password.' });
        }

        // Generate JWT for admin
        const token = jwt.sign({ id: admin._id.toString(), role: admin.role }, JWT_SECRET, { expiresIn: '1h' });
        res.status(200).json({ message: 'Admin login successful', token, adminId: admin._id, role: admin.role });
    } catch (error) {
        console.error("Error logging in admin:", error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Use Case: Fetch All Users (Customers & Drivers)
// Endpoint: /admin/users
// Method: GET
app.get('/admin/users', authenticateToken, authorizeRoles(['admin']), async (req, res) => {
    try {
        const customers = await db.collection('customers').find({}).project({ password: 0 }).toArray(); // Exclude passwords
        const drivers = await db.collection('drivers').find({}).project({ password: 0 }).toArray(); // Exclude passwords
        res.status(200).json({ customers, drivers });
    } catch (error) {
        console.error("Error fetching all users (admin):", error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Use Case: Block Users (Customer or Driver)
// Endpoint: /admin/block/:type/:id
// Method: PATCH
app.patch('/admin/block/:type/:id', authenticateToken, authorizeRoles(['admin']), async (req, res) => {
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
app.get('/admin/reports', authenticateToken, authorizeRoles(['admin']), async (req, res) => {
    try {
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