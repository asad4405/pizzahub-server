import express from "express";
import cors from 'cors';
import 'dotenv/config';
import { MongoClient } from 'mongodb';

const app = express();
const PORT = process.env.PORT || 8000;

// middleware
app.use(cors());
app.use(express.json());

const client = new MongoClient(`${process.env.MONGODB_URL}`);

export async function connectToMongoDB() {
    try {
        await client.connect();
        return client;
    } catch (err) {
        console.dir(err);
    }
}

const connectedClient = await connectToMongoDB();
const db = connectedClient.db('pizzahub');
const menuItemsCollection = db.collection("menu");
const usersCollection = db.collection("user");

app.get("/", (req, res) => {
    res.send("Server Runing ...");
});

// vendor wise menu list
app.get("/api/menu-items/vendor/:vendorId", async (req, res) => {
    const vendor = await usersCollection.findOne({ id: req.params.vendorId });
    const items = await menuItemsCollection
        .find({ vendorId: req.params.vendorId })
        .sort({ createdAt: -1 })
        .toArray();

    res.send({
        success: true,
        items,
        isPremium: vendor?.subscriptionPlan === "premium",
    });
});
// create menu
app.post("/api/menu-items", async (req, res) => {
    const { vendorId, itemName, category, description, price, location, image, imageUrl } = req.body;

    const vendor = await usersCollection.findOne({ id: vendorId });
    const isPremium = vendor?.subscriptionPlan === "premium";

    const activeCount = await menuItemsCollection.countDocuments({
        vendorId,
        status: { $in: ["pending", "approved"] },
    });

    if (!isPremium && activeCount >= 3) {
        return res.send({ success: false, message: "Free plan limit: max 3 active items" });
    }

    const newItem = {
        vendorId,
        itemName,
        category,
        description: description || "",
        price: Number(price),
        location,
        image: (image || imageUrl || "").trim(),
        status: "pending",
        createdAt: new Date(),
    };

    const result = await menuItemsCollection.insertOne(newItem);
    res.send({
        success: true,
        message: "Menu item added successfully!",
        _id: result.insertedId,
        ...newItem,
    });
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});