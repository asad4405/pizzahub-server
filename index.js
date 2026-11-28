import express from "express";
import cors from 'cors';
import 'dotenv/config';
import { MongoClient, ObjectId } from 'mongodb';

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
const ordersCollection = db.collection("order");

app.get("/", (req, res) => {
    res.send("Server Runing ...");
});

// =========================== website part start ========================= //
//menu list
app.get("/api/menu-items", async (req, res) => {
    const query = {};

    query.status = "approved";

    if (req.query.category && req.query.category !== "all") {
        query.category = String(req.query.category);
    }

    if (req.query.location && req.query.location !== "all") {
        query.location = { $regex: String(req.query.location), $options: "i" };
    }

    if (req.query.search && String(req.query.search).trim() !== "") {
        const searchTerm = String(req.query.search).trim();
        query.$or = [
            { itemName: { $regex: searchTerm, $options: "i" } },
            { description: { $regex: searchTerm, $options: "i" } },
        ];
    }

    const sortOption = {};
    if (req.query.sort === "price_asc") {
        sortOption.price = 1;
    } else if (req.query.sort === "price_desc") {
        sortOption.price = -1;
    } else {
        sortOption.createdAt = -1;
        sortOption._id = -1;
    }

    const items = await menuItemsCollection
        .find(query)
        .sort(sortOption)
        .toArray();

    res.send({ success: true, items });
});

// menu item details
app.get("/api/menu-items/:id", async (req, res) => {
    const { id } = req.params;

    const query = {
        status: "approved",
        ...(ObjectId.isValid(id)
            ? { $or: [{ _id: new ObjectId(id) }, { _id: id }] }
            : { _id: id }),
    };

    const item = await menuItemsCollection.findOne(query);

    if (!item) {
        return res.status(404).send({
            success: false,
            message: "Menu item not found",
        });
    }

    res.send({ success: true, item });
});
// =========================== website part end ========================= //

// =========================== customer part start ========================= //
// create order 
app.post("/api/orders", async (req, res) => {
    const {
        menuItemId,
        itemName,
        price,
        vendorId,
        vendorName,
        deliveryDate,
        deliveryAddress,
        note,
        customerId,
        customerName,
        customerEmail,
        customerRole,
    } = req.body;

    if (!customerId && !customerEmail) {
        return res.status(401).send({ success: false, message: "Login required" });
    }

    if (customerRole !== "customer") {
        return res.status(403).send({ success: false, message: "Only customers can order" });
    }

    if (!menuItemId || !deliveryDate || !deliveryAddress) {
        return res.status(400).send({ success: false, message: "Required fields missing" });
    }

    const newOrder = {
        menuItemId,
        itemName,
        price,
        vendorId,
        vendorName,
        deliveryDate,
        deliveryAddress,
        note: note || "",
        customerId: customerId || null,
        customerName: customerName || "",
        customerEmail: customerEmail || "",
        status: "pending",
        createdAt: new Date(),
    };

    const result = await ordersCollection.insertOne(newOrder);
    res.status(201).send({ success: true, order: { _id: result.insertedId, ...newOrder } });
});

// get orders 
app.get("/api/orders", async (req, res) => {
    const { customerId, customerEmail } = req.query;
    const query = {};

    if (customerId) {
        query.customerId = customerId;
    } else if (customerEmail) {
        query.customerEmail = customerEmail;
    }

    const orders = await ordersCollection
        .find(query)
        .sort({ createdAt: -1 })
        .toArray();

    res.send({
        success: true,
        orders,
    });
});

// cancel order customer only pending
app.patch("/api/orders/:id/cancel", async (req, res) => {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
        return res.status(400).send({ success: false, message: "Invalid order ID" });
    }

    const order = await ordersCollection.findOne({ _id: new ObjectId(id) });

    if (!order) {
        return res.status(404).send({ success: false, message: "Order not found" });
    }

    if (order.status !== "pending") {
        return res.status(400).send({
            success: false,
            message: "Only pending orders can be cancelled",
        });
    }

    await ordersCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status: "cancelled", updatedAt: new Date() } }
    );

    res.send({ success: true, message: "Order cancelled successfully" });
});

// get & update customer profile
app.route("/api/customer/profile")
    .get(async (req, res) => {
        const { email, userId } = req.query;

        if (!email && !userId) {
            return res.status(400).send({
                success: false,
                message: "Email or userId is required",
            });
        }

        const filter = email
            ? { email }
            : ObjectId.isValid(userId)
                ? { _id: new ObjectId(userId) }
                : { id: userId };

        const profile = await usersCollection.findOne(filter);

        if (!profile) {
            return res.status(404).send({
                success: false,
                message: "Customer profile not found",
            });
        }

        res.send({
            success: true,
            profile,
        });
    })
    .patch(async (req, res) => {
        const { userId, email, name, phone, address, image } = req.body;

        if (!userId && !email) {
            return res.status(400).send({
                success: false,
                message: "User ID or email is required",
            });
        }

        const filter = email
            ? { email }
            : ObjectId.isValid(userId)
                ? { _id: new ObjectId(userId) }
                : { id: userId };

        const updateDoc = {
            $set: {
                name: name || "",
                phone: phone || "",
                address: address || "",
                image: image || "",
                updatedAt: new Date(),
            },
        };

        const result = await usersCollection.updateOne(filter, updateDoc);

        if (result.matchedCount === 0) {
            return res.status(404).send({
                success: false,
                message: "Customer profile not found",
            });
        }

        res.send({
            success: true,
            message: "Customer profile updated successfully",
        });
    });


// =========================== customer part end ========================= //


//  =========================== vendor part start ========================= //
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
// vendor create menu
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
// vendor status menu 
app.patch("/api/menu-items/:id/status", async (req, res) => {
    const { id } = req.params;
    const { vendorId, status } = req.body;

    if (!ObjectId.isValid(id)) {
        return res.send({ success: false, message: "Invalid menu item ID" });
    }

    const allowedVendorStatuses = ["inactive", "pending"];
    if (!allowedVendorStatuses.includes(status)) {
        return res.send({ success: false, message: "Invalid status for vendor" });
    }

    if (status === "pending") {
        const vendor = await usersCollection.findOne({ id: vendorId });
        const isPremium = vendor?.subscriptionPlan === "premium";
        const activeCount = await menuItemsCollection.countDocuments({
            vendorId,
            _id: { $ne: new ObjectId(id) },
            status: { $in: ["pending", "approved"] },
        });

        if (!isPremium && activeCount >= 3) {
            return res.send({ success: false, message: "Free plan limit: max 3 active items" });
        }
    }

    const result = await menuItemsCollection.updateOne(
        { _id: new ObjectId(id), vendorId },
        { $set: { status } }
    );

    if (result.matchedCount === 0) {
        return res.send({ success: false, message: "Menu item not found" });
    }

    res.send({ success: true, message: `Menu item marked as ${status}!` });
});

// vendor edit menu
app.patch("/api/menu-items/:id", async (req, res) => {
    const { id } = req.params;
    const { vendorId, itemName, category, price, location, description, image, imageUrl } = req.body;

    if (!ObjectId.isValid(id)) {
        return res.send({ success: false, message: "Invalid menu item ID" });
    }

    const updatedFields = {
        itemName,
        category,
        price: Number(price),
        location,
        description: description || "",
        image: (image ?? imageUrl ?? "").trim(),
        status: "pending",
    };

    const result = await menuItemsCollection.updateOne(
        { _id: new ObjectId(id), vendorId },
        { $set: updatedFields }
    );

    if (result.matchedCount === 0) {
        return res.send({ success: false, message: "Menu item not found" });
    }

    res.send({ success: true, message: "Menu item updated successfully!" });
});

// vendor delete menu
app.delete("/api/menu-items/:id", async (req, res) => {
    const { id } = req.params;
    const vendorId = req.body?.vendorId || req.query?.vendorId;

    if (!ObjectId.isValid(id)) {
        return res.send({ success: false, message: "Invalid menu item ID" });
    }

    const result = await menuItemsCollection.deleteOne({
        _id: new ObjectId(id),
        ...(vendorId ? { vendorId } : {}),
    });

    if (result.deletedCount === 0) {
        return res.send({ success: false, message: "Menu item not found" });
    }

    res.send({ success: true, message: "Menu item deleted successfully!" });
});

// get orders 
app.get("/api/orders", async (req, res) => {
    const { vendorId, customerId, customerEmail } = req.query;

    if (!vendorId && !customerId && !customerEmail) {
        return res.send({
            success: true,
            orders: [],
        });
    }

    const query = {};

    if (vendorId) {
        query.vendorId = vendorId;
    } else if (customerId) {
        query.customerId = customerId;
    } else if (customerEmail) {
        query.customerEmail = customerEmail;
    }

    const orders = await ordersCollection
        .find(query)
        .sort({ createdAt: -1 })
        .toArray();

    res.send({
        success: true,
        orders,
    });
});

// update order status by vendor
app.patch("/api/orders/:id/status", async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    const allowedStatuses = ["pending", "accepted", "preparing", "delivered", "cancelled"];

    if (!ObjectId.isValid(id)) {
        return res.status(400).send({ success: false, message: "Invalid order ID" });
    }

    if (!allowedStatuses.includes(status)) {
        return res.status(400).send({ success: false, message: "Invalid status value" });
    }

    const result = await ordersCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status, updatedAt: new Date() } }
    );

    if (result.matchedCount === 0) {
        return res.status(404).send({ success: false, message: "Order not found" });
    }

    res.send({ success: true, message: `Order marked as ${status}` });
});

// update vendor profile
app.route("/api/vendor/profile")
    .get(async (req, res) => {
        const { email, userId } = req.query;

        if (!email && !userId) {
            return res.status(400).send({
                success: false,
                message: "Email or userId is required",
            });
        }

        const filter = email
            ? { email }
            : ObjectId.isValid(userId)
                ? { _id: new ObjectId(userId) }
                : { id: userId };

        const profile = await usersCollection.findOne(filter);

        if (!profile) {
            return res.status(404).send({
                success: false,
                message: "Vendor profile not found",
            });
        }

        res.send({
            success: true,
            profile,
        });
    })
    .patch(async (req, res) => {
        const {
            userId,
            email,
            name,
            businessName,
            phone,
            address,
            description,
            image,
        } = req.body;

        if (!userId && !email) {
            return res.status(400).send({
                success: false,
                message: "User ID or email is required",
            });
        }

        const filter = email
            ? { email }
            : ObjectId.isValid(userId)
                ? { _id: new ObjectId(userId) }
                : { id: userId };

        const updateDoc = {
            $set: {
                name: name || "",
                businessName: businessName || "",
                vendorName: businessName || "",
                phone: phone || "",
                address: address || "",
                description: description || "",
                image: image || "",
                updatedAt: new Date(),
            },
        };

        const result = await usersCollection.updateOne(filter, updateDoc);

        if (result.matchedCount === 0) {
            return res.status(404).send({
                success: false,
                message: "Vendor profile not found",
            });
        }

        res.send({
            success: true,
            message: "Profile updated successfully",
        });
    });
//  =========================== vendor part end ========================= //


//  =========================== admin part start ========================= //
// admin menu data
app.get("/api/admin/menu-items", async (req, res) => {
    const status = req.query.status ? String(req.query.status) : "";
    const filter = status && status !== "all" ? { status } : {};

    const items = await menuItemsCollection
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .toArray();

    res.send({ success: true, items });
});

// admin status update
app.patch("/api/admin/menu-items/:id/status", async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    if (!ObjectId.isValid(id)) {
        return res.send({ success: false, message: "Invalid menu item ID" });
    }

    const allowedAdminStatuses = ["approved", "rejected"];
    if (!allowedAdminStatuses.includes(status)) {
        return res.send({
            success: false,
            message: "Admin can only set status to approved or rejected",
        });
    }

    const result = await menuItemsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status } }
    );

    if (result.matchedCount === 0) {
        return res.send({ success: false, message: "Menu item not found" });
    }

    res.send({ success: true, message: `Menu item marked as ${status}!` });
});
// admin menu delete
app.delete("/api/admin/menu-items/:id", async (req, res) => {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
        return res.send({ success: false, message: "Invalid menu item ID" });
    }

    const result = await menuItemsCollection.deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
        return res.send({ success: false, message: "Menu item not found" });
    }

    res.send({ success: true, message: "Menu item deleted successfully!" });
});

// get orders 
app.get("/api/orders", async (req, res) => {
    const { vendorId, customerId, customerEmail } = req.query;
    const query = {};

    if (vendorId) {
        query.vendorId = vendorId;
    } else if (customerId) {
        query.customerId = customerId;
    } else if (customerEmail) {
        query.customerEmail = customerEmail;
    }

    const orders = await ordersCollection
        .find(query)
        .sort({ createdAt: -1 })
        .toArray();

    res.send({
        success: true,
        orders,
    });
});

// update order status admin
app.patch("/api/orders/:id/status", async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    const allowedStatuses = ["pending", "accepted", "preparing", "delivered", "cancelled"];

    if (!ObjectId.isValid(id)) {
        return res.status(400).send({ success: false, message: "Invalid order ID" });
    }

    if (!allowedStatuses.includes(status)) {
        return res.status(400).send({ success: false, message: "Invalid status value" });
    }

    const result = await ordersCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status, updatedAt: new Date() } }
    );

    if (result.matchedCount === 0) {
        return res.status(404).send({ success: false, message: "Order not found" });
    }

    res.send({ success: true, message: `Order marked as ${status}` });
});

// delete order admin
app.delete("/api/orders/:id", async (req, res) => {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
        return res.status(400).send({ success: false, message: "Invalid order ID" });
    }

    const result = await ordersCollection.deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
        return res.status(404).send({ success: false, message: "Order not found" });
    }

    res.send({ success: true, message: "Order deleted successfully" });
});

// get & update admin profile
app.route("/api/admin/profile")
    .get(async (req, res) => {
        const { email, userId } = req.query;

        if (!email && !userId) {
            return res.status(400).send({
                success: false,
                message: "Email or userId is required",
            });
        }

        const filter = email
            ? { email }
            : ObjectId.isValid(userId)
                ? { _id: new ObjectId(userId) }
                : { id: userId };

        const profile = await usersCollection.findOne(filter);

        if (!profile) {
            return res.status(404).send({
                success: false,
                message: "Admin profile not found",
            });
        }

        res.send({
            success: true,
            profile,
        });
    })
    .patch(async (req, res) => {
        const { userId, email, name, phone, address, image } = req.body;

        if (!userId && !email) {
            return res.status(400).send({
                success: false,
                message: "User ID or email is required",
            });
        }

        const filter = email
            ? { email }
            : ObjectId.isValid(userId)
                ? { _id: new ObjectId(userId) }
                : { id: userId };

        const updateDoc = {
            $set: {
                name: name || "",
                phone: phone || "",
                address: address || "",
                image: image || "",
                updatedAt: new Date(),
            },
        };

        const result = await usersCollection.updateOne(filter, updateDoc);

        if (result.matchedCount === 0) {
            return res.status(404).send({
                success: false,
                message: "Admin profile not found",
            });
        }

        res.send({
            success: true,
            message: "Admin profile updated successfully",
        });
    });
//  =========================== admin part end ========================= //

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});