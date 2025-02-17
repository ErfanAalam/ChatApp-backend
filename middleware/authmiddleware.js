import jwt from "jsonwebtoken";
import userModel from "../models/user.model.js";

const authMiddleware = async (req, res, next) => {
  try {
    const token = req.cookies.token;


    if (!token) {
      return res.status(401).json({ result: "No token, authorization denied" });
    }

    const decoded = jwt.verify(token, process.env.SECRET_KEY);

    if (!decoded) {
      return res.status(401).json({ result: "Invalid Token" });
    }

    const user = await userModel.findById(decoded.id).select("-password");

    if (!user) {
      return res.status(404).json({ error: "No user found" });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error("Error in authentication:");
    res.status(500).json({ error: "Server error" });
  }
};

export default authMiddleware;
