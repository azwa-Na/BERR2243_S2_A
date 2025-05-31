const jwt = require('jsonwebtoken');   
 
app.post('/auth/login', async (req, res) => {   
  const user = await db.collection('users').findOne({ email: req.body.email
 });   
  if (!user || !(await bcrypt.compare(req.body.password, user.password))) {   
    return res.status(401).json({ error: "Invalid credentials" });   
  }   
  const token = jwt.sign(   
    { userId: user._id, role: user.role },   
    process.env.JWT_SECRET,   
    { expiresIn: process.env.JWT_EXPIRES_IN }   
  );   
  res.status(200).json({ token }); // Return token to client   
});