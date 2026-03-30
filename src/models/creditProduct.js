const mongoose = require("mongoose");

const creditProductSchema = new mongoose.Schema(
	{
		title: { type: String, required: true, trim: true },
		description: { type: String, trim: true },
		amount: { type: Number, required: true, min: 0 },
		currency: { type: String, default: "usd" },
		smsCredits: { type: Number, default: 0, min: 0 },
		emailCredits: { type: Number, default: 0, min: 0 },
		stripeProductId: { type: String, required: true },
		stripePriceId: { type: String, required: true },
		isActive: { type: Boolean, default: true },
	},
	{ timestamps: true }
);

module.exports = mongoose.model("CreditProduct", creditProductSchema);


