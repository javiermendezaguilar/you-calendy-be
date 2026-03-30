const swaggerAutogen = require("swagger-autogen")();
const doc = {
  info: {
    title: "You-calendy API",
    description: "Backend API documentation for You-calendy application",
    version: "1.0.0",
  },
  host:
    process.env.NODE_ENV === "production"
      ? "your-production-host.com"
      : "localhost:5000",
  basePath: "/",
  schemes: ["http", "https"],
  consumes: ["application/json"],
  produces: ["application/json"],
  tags: [
    {
      name: "Auth",
      description: "Authentication endpoints",
    },
    {
      name: "Business",
      description: "Business management endpoints",
    },
    {
      name: "Appointments",
      description: "Appointment booking and management",
    },
    {
      name: "Services",
      description: "Business services management",
    },
    {
      name: "Promotions",
      description: "Happy Hours and promotion management",
    },
    {
      name: "Flash Sales",
      description: "Time-based flash sale management",
    },
    {
      name: "Credits",
      description: "SMS and Email credits management",
    },
  ],
  securityDefinitions: {
    Bearer: {
      type: "apiKey",
      name: "authorization",
      in: "header",
      description: "Enter your bearer token in the format 'Bearer {token}'",
    },
  },
  definitions: {
    User: {
      type: "object",
      properties: {
        _id: {
          type: "string",
          example: "64a1b4ff12345a6789abcdef",
        },
        name: {
          type: "string",
          example: "John Doe",
        },
        email: {
          type: "string",
          example: "john@example.com",
        },
        phone: {
          type: "string",
          example: "+123456789",
        },
        role: {
          type: "string",
          example: "barber",
          enum: ["barber", "admin", "sub-admin"],
        },
        status: {
          type: "string",
          example: "activated",
          enum: ["activated", "deactivated"],
        },
        isActive: {
          type: "boolean",
          example: true,
        },
        profileImage: {
          type: "string",
          example: "https://example.com/profile.jpg",
        },
        country: {
          type: "string",
          example: "United States",
        },
        zip: {
          type: "string",
          example: "10001",
        },
        deviceToken: {
          type: "string",
          example: "device_token_here",
        },
        isNotificationEnabled: {
          type: "boolean",
          example: true,
        },
        notificationSettings: {
          type: "object",
          properties: {
            barberRegistration: {
              type: "boolean",
              example: true,
              description: "Notifications when a barber registers",
            },
            subscriptionExpiry: {
              type: "boolean",
              example: true,
              description:
                "Notifications when barber's subscription is about to expire or has been canceled",
            },
            bookingSpike: {
              type: "boolean",
              example: true,
              description:
                "Notifications when barber experiences a sudden spike in bookings that may need support",
            },
          },
        },
        provider: {
          type: "string",
          example: "app",
          enum: ["app", "google", "facebook"],
        },
        createdAt: {
          type: "string",
          format: "date-time",
          example: "2024-01-01T00:00:00.000Z",
        },
        lastLogin: {
          type: "string",
          format: "date-time",
          example: "2024-01-01T00:00:00.000Z",
        },
      },
    },
    AuthResponse: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
          example: true,
        },
        data: {
          type: "object",
          properties: {
            user: {
              $ref: "#/definitions/User",
            },
            token: {
              type: "string",
              example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
            },
          },
        },
      },
    },
    Business: {
      type: "object",
      properties: {
        _id: {
          type: "string",
          example: "64a1b4ff12345a6789abcdef",
        },
        owner: {
          type: "string",
          example: "64a1b4ff12345a6789abcdef",
        },
        name: {
          type: "string",
          example: "My Business",
        },
        contactInfo: {
          type: "object",
          properties: {
            email: {
              type: "string",
              example: "business@example.com",
            },
            phone: {
              type: "string",
              example: "+123456789",
            },
          },
        },
        socialMedia: {
          type: "object",
          properties: {
            facebook: {
              type: "string",
              example: "fb.com/mybusiness",
            },
            instagram: {
              type: "string",
              example: "instagram.com/mybusiness",
            },
            twitter: {
              type: "string",
              example: "twitter.com/mybusiness",
            },
          },
        },
        address: {
          type: "object",
          properties: {
            streetName: {
              type: "string",
              example: "Main Street",
            },
            houseNumber: {
              type: "string",
              example: "123",
            },
            city: {
              type: "string",
              example: "New York",
            },
            postalCode: {
              type: "string",
              example: "10001",
            },
          },
        },
        location: {
          type: "object",
          properties: {
            type: {
              type: "string",
              example: "Point",
            },
            coordinates: {
              type: "array",
              example: [-73.935242, 40.73061],
              items: {
                type: "number",
              },
            },
            address: {
              type: "string",
              example: "123 Main Street, New York, 10001",
            },
          },
        },
        businessHours: {
          type: "object",
          properties: {
            monday: {
              type: "object",
              properties: {
                enabled: {
                  type: "boolean",
                  example: true,
                },
                shifts: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      start: {
                        type: "string",
                        example: "10:00",
                      },
                      end: {
                        type: "string",
                        example: "14:00",
                      },
                    },
                  },
                },
              },
            },
            tuesday: {
              type: "object",
            },
            wednesday: {
              type: "object",
            },
            thursday: {
              type: "object",
            },
            friday: {
              type: "object",
            },
            saturday: {
              type: "object",
            },
            sunday: {
              type: "object",
            },
          },
        },
        services: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: {
                type: "string",
                example: "Haircut",
              },
              type: {
                type: "string",
                example: "Salon",
              },
              duration: {
                type: "string",
                example: "30min",
              },
              price: {
                type: "number",
                example: 25.0,
              },
              isFromEnabled: {
                type: "boolean",
                example: false,
              },
            },
          },
        },
        profileImages: {
          type: "object",
          properties: {
            logo: {
              type: "string",
              example: "https://example.com/logo.png",
            },
            coverPhoto: {
              type: "string",
              example: "https://example.com/cover.png",
            },
            workspacePhotos: {
              type: "array",
              items: {
                type: "string",
                example: "https://example.com/workspace1.png",
              },
            },
          },
        },
      },
    },
    BusinessService: {
      type: "object",
      properties: {
        name: {
          type: "string",
          example: "Haircut",
        },
        type: {
          type: "string",
          example: "Salon",
        },
        duration: {
          type: "string",
          example: "30min",
        },
        price: {
          type: "number",
          example: 25.0,
        },
        isFromEnabled: {
          type: "boolean",
          example: false,
        },
      },
    },
    Service: {
      type: "object",
      properties: {
        _id: {
          type: "string",
          example: "64a1b4ff12345a6789abcdef",
        },
        business: {
          type: "string",
          example: "64a1b4ff12345a6789abcdef",
        },
        name: {
          type: "string",
          example: "Haircut",
        },
        description: {
          type: "string",
          example: "Basic haircut service",
        },
        duration: {
          type: "number",
          example: 30,
        },
        price: {
          type: "number",
          example: 25.0,
        },
        image: {
          type: "object",
          properties: {
            url: {
              type: "string",
              example: "https://example.com/haircut.jpg",
            },
            public_id: {
              type: "string",
              example: "services/haircut_123",
            },
          },
        },
        isActive: {
          type: "boolean",
          example: true,
        },
        category: {
          type: "string",
          example: "Hair",
        },
      },
    },
    ServiceList: {
      type: "array",
      items: {
        $ref: "#/definitions/Service",
      },
    },
    Appointment: {
      type: "object",
      properties: {
        _id: {
          type: "string",
          example: "64a1b4ff12345a6789abcdef",
        },
        client: {
          type: "string",
          example: "64a1b4ff12345a6789abcdef",
        },
        business: {
          type: "string",
          example: "64a1b4ff12345a6789abcdef",
        },
        service: {
          type: "string",
          example: "64a1b4ff12345a6789abcdef",
        },
        date: {
          type: "string",
          format: "date",
          example: "2025-03-15",
        },
        startTime: {
          type: "string",
          example: "10:00",
        },
        endTime: {
          type: "string",
          example: "10:30",
        },
        duration: {
          type: "number",
          example: 30,
        },
        status: {
          type: "string",
          enum: ["Pending", "Confirmed", "Canceled", "Completed", "No-Show"],
          example: "Confirmed",
        },
        notes: {
          type: "string",
          example: "Notes for the provider",
        },
        clientNotes: {
          type: "string",
          example: "Client special requests",
        },
        price: {
          type: "number",
          example: 25.0,
        },
      },
    },
    AppointmentList: {
      type: "object",
      properties: {
        appointments: {
          type: "array",
          items: {
            $ref: "#/definitions/Appointment",
          },
        },
        pagination: {
          type: "object",
          properties: {
            total: {
              type: "number",
              example: 50,
            },
            page: {
              type: "number",
              example: 1,
            },
            pages: {
              type: "number",
              example: 5,
            },
          },
        },
      },
    },
    Promotion: {
      type: "object",
      properties: {
        _id: {
          type: "string",
          example: "64a1b4ff12345a6789abcdef",
        },
        business: {
          type: "string",
          example: "64a1b4ff12345a6789abcdef",
        },
        name: {
          type: "string",
          example: "Monday Happy Hours",
        },
        description: {
          type: "string",
          example: "20% off all haircuts on Monday afternoons",
        },
        dayOfWeek: {
          type: "string",
          example: "monday",
          enum: [
            "monday",
            "tuesday",
            "wednesday",
            "thursday",
            "friday",
            "saturday",
            "sunday",
          ],
        },
        startTime: {
          type: "string",
          example: "14:00",
        },
        endTime: {
          type: "string",
          example: "18:00",
        },
        discountPercentage: {
          type: "number",
          example: 20,
          minimum: 1,
          maximum: 100,
        },
        services: [
          {
            type: "string",
            example: "64a1b4ff12345a6789abcdef",
          },
        ],
        isActive: {
          type: "boolean",
          example: true,
        },
        createdAt: {
          type: "string",
          format: "date-time",
          example: "2024-01-01T00:00:00.000Z",
        },
        updatedAt: {
          type: "string",
          format: "date-time",
          example: "2024-01-01T00:00:00.000Z",
        },
      },
    },
    FlashSale: {
      type: "object",
      properties: {
        _id: {
          type: "string",
          example: "64a1b4ff12345a6789abcdef",
        },
        business: {
          type: "string",
          example: "64a1b4ff12345a6789abcdef",
        },
        name: {
          type: "string",
          example: "Summer Flash Sale",
        },
        description: {
          type: "string",
          example: "30% off all services for 24 hours",
        },
        startDate: {
          type: "string",
          format: "date-time",
          example: "2024-06-15T10:00:00.000Z",
        },
        endDate: {
          type: "string",
          format: "date-time",
          example: "2024-06-16T10:00:00.000Z",
        },
        discountPercentage: {
          type: "number",
          example: 30,
          minimum: 1,
          maximum: 100,
        },
        isActive: {
          type: "boolean",
          example: true,
        },
        createdAt: {
          type: "string",
          format: "date-time",
          example: "2024-01-01T00:00:00.000Z",
        },
        updatedAt: {
          type: "string",
          format: "date-time",
          example: "2024-01-01T00:00:00.000Z",
        },
      },
    },
    CreditProduct: {
      type: "object",
      properties: {
        _id: {
          type: "string",
          example: "64a1b4ff12345a6789abcdef",
        },
        title: {
          type: "string",
          example: "SMS 1000 Credits",
        },
        description: {
          type: "string",
          example: "1000 SMS credits for messaging campaigns",
        },
        amount: {
          type: "number",
          example: 25.0,
        },
        currency: {
          type: "string",
          example: "usd",
        },
        smsCredits: {
          type: "number",
          example: 1000,
        },
        emailCredits: {
          type: "number",
          example: 0,
        },
        stripeProductId: {
          type: "string",
          example: "prod_1234567890",
        },
        stripePriceId: {
          type: "string",
          example: "price_1234567890",
        },
        isActive: {
          type: "boolean",
          example: true,
        },
        createdAt: {
          type: "string",
          format: "date-time",
          example: "2024-01-01T00:00:00.000Z",
        },
        updatedAt: {
          type: "string",
          format: "date-time",
          example: "2024-01-01T00:00:00.000Z",
        },
      },
    },
    CreditProductList: {
      type: "array",
      items: {
        $ref: "#/definitions/CreditProduct",
      },
    },
    CheckoutSession: {
      type: "object",
      properties: {
        id: {
          type: "string",
          example: "cs_1234567890",
        },
        url: {
          type: "string",
          example: "https://checkout.stripe.com/pay/cs_1234567890",
        },
      },
    },
  },
};

const outputFile = "./swagger_output.json";
const endpointsFiles = ["./src/router/index.js"];

// Create custom route documentation for swagger-autogen
// This adds tags to routes explicitly
const autoGenOptions = {
  openapi: "3.0.0",
  autoHeaders: true,
  autoQuery: true,
  autoBody: true,
};

// Add JSDoc annotations for swagger routes in a file that swagger-autogen will read
// This is a trick to add tags to routes that are generated by swagger-autogen
const routeDocs = {
  "/auth/register": {
    post: {
      tags: ["Auth"],
    },
  },
  "/auth/login": {
    post: {
      tags: ["Auth"],
    },
  },
  "/auth/forgotPassword": {
    post: {
      tags: ["Auth"],
    },
  },
  "/auth/resetPassword": {
    put: {
      tags: ["Auth"],
    },
  },
  "/auth/updatePassword": {
    put: {
      tags: ["Auth"],
    },
  },
  "/auth/me": {
    get: {
      tags: ["Auth"],
    },
  },
  "/auth/updateProfile": {
    put: {
      tags: ["Auth"],
    },
  },
  "/auth/updateAdminProfile": {
    put: {
      tags: ["Auth"],
    },
  },
  "/auth/socialAuth": {
    post: {
      tags: ["Auth"],
    },
  },
  "/business/": {
    get: {
      tags: ["Business"],
    },
    put: {
      tags: ["Business"],
    },
  },
  "/business/{id}": {
    get: {
      tags: ["Business"],
    },
  },
  "/business/info": {
    put: {
      tags: ["Business"],
    },
  },
  "/business/address": {
    put: {
      tags: ["Business"],
    },
  },
  "/business/location": {
    put: {
      tags: ["Business"],
    },
  },
  "/business/hours": {
    put: {
      tags: ["Business"],
    },
  },
  "/business/services": {
    get: {
      tags: ["Business"],
    },
    post: {
      tags: ["Business"],
    },
  },
  "/business/services/{serviceId}": {
    put: {
      tags: ["Business"],
    },
    delete: {
      tags: ["Business"],
    },
  },
  "/business/images/{type}": {
    put: {
      tags: ["Business"],
    },
  },
  "/business/images/workspace": {
    post: {
      tags: ["Business"],
    },
  },
  "/business/images/workspace/{photoIndex}": {
    delete: {
      tags: ["Business"],
    },
  },

  // Appointment routes
  "/appointments": {
    post: {
      tags: ["Appointments"],
    },
    get: {
      tags: ["Appointments"],
    },
  },
  "/appointments/available": {
    get: {
      tags: ["Appointments"],
    },
  },
  "/appointments/{id}": {
    get: {
      tags: ["Appointments"],
    },
    put: {
      tags: ["Appointments"],
    },
  },
  "/appointments/{id}/status": {
    put: {
      tags: ["Appointments"],
    },
  },

  // Service routes
  "/services": {
    get: {
      tags: ["Services"],
    },
    post: {
      tags: ["Services"],
    },
  },
  "/services/categories": {
    get: {
      tags: ["Services"],
    },
  },
  "/services/{id}": {
    get: {
      tags: ["Services"],
    },
    put: {
      tags: ["Services"],
    },
    delete: {
      tags: ["Services"],
    },
  },

  // Promotion routes
  "/promotions": {
    post: {
      tags: ["Promotions"],
    },
    get: {
      tags: ["Promotions"],
    },
  },
  "/promotions/active": {
    get: {
      tags: ["Promotions"],
    },
  },
  "/promotions/stats": {
    get: {
      tags: ["Promotions"],
    },
  },
  "/promotions/{id}": {
    get: {
      tags: ["Promotions"],
    },
    put: {
      tags: ["Promotions"],
    },
    delete: {
      tags: ["Promotions"],
    },
  },
  "/promotions/{id}/toggle": {
    patch: {
      tags: ["Promotions"],
    },
  },

  // Flash Sale routes
  "/flash-sales": {
    post: {
      tags: ["Flash Sales"],
    },
    get: {
      tags: ["Flash Sales"],
    },
  },
  "/flash-sales/active": {
    get: {
      tags: ["Flash Sales"],
    },
  },
  "/flash-sales/stats": {
    get: {
      tags: ["Flash Sales"],
    },
  },
  "/flash-sales/{id}": {
    get: {
      tags: ["Flash Sales"],
    },
    put: {
      tags: ["Flash Sales"],
    },
    delete: {
      tags: ["Flash Sales"],
    },
  },
  "/flash-sales/{id}/toggle": {
    patch: {
      tags: ["Flash Sales"],
    },
  },

  // New freemium/premium endpoints
  "/api/business/start-trial": {
    post: {
      tags: ["Business"],
      summary: "Start a free 2-week trial for the business (only once, after setup)",
      security: [{ Bearer: [] }],
      responses: {
        200: {
          description: "Trial started successfully",
          schema: {
            message: "Trial started",
            trialEnd: "2024-07-01T00:00:00.000Z"
          }
        },
        400: { description: "Trial already used or setup incomplete" },
        404: { description: "Business not found" }
      }
    }
  },
  "/api/business/subscription-status": {
    get: {
      tags: ["Business"],
      summary: "Get current trial/subscription status and frontend message",
      security: [{ Bearer: [] }],
      responses: {
        200: {
          description: "Status and message",
          schema: {
            status: "trialing | active | none | past_due | canceled | ...",
            daysLeft: 7,
            message: "Your trial ends in 7 days."
          }
        },
        404: { description: "Business not found" }
      }
    }
  },
  "/api/business/create-subscription": {
    post: {
      tags: ["Business"],
      summary: "Create a Stripe subscription for the business (with 14-day trial if eligible)",
      security: [{ Bearer: [] }],
      responses: {
        200: {
          description: "Stripe subscription created",
          schema: {
            subscriptionId: "sub_1234567890",
            status: "trialing | active | ..."
          }
        },
        400: { description: "Start your free trial first" },
        404: { description: "Business not found" }
      }
    }
  },

  // Credits routes
  "/credits/products": {
    get: {
      tags: ["Credits"],
      summary: "List all active credit products",
      description: "Public endpoint to get available SMS and Email credit bundles",
      responses: {
        200: {
          description: "List of active credit products",
          schema: { $ref: "#/definitions/CreditProductList" }
        }
      }
    },
    post: {
      tags: ["Credits"],
      summary: "Create a new credit product (Admin only)",
      description: "Create a new SMS/Email credit bundle with Stripe integration",
      security: [{ Bearer: [] }],
      parameters: [
        {
          name: "title",
          in: "body",
          required: true,
          schema: { type: "string", example: "SMS 1000 Credits" }
        },
        {
          name: "description",
          in: "body",
          schema: { type: "string", example: "1000 SMS credits for messaging campaigns" }
        },
        {
          name: "amount",
          in: "body",
          required: true,
          schema: { type: "number", example: 25.0 }
        },
        {
          name: "currency",
          in: "body",
          schema: { type: "string", example: "usd" }
        },
        {
          name: "smsCredits",
          in: "body",
          schema: { type: "number", example: 1000 }
        },
        {
          name: "emailCredits",
          in: "body",
          schema: { type: "number", example: 0 }
        }
      ],
      responses: {
        201: {
          description: "Credit product created successfully",
          schema: { $ref: "#/definitions/CreditProduct" }
        },
        400: { description: "Validation error" },
        403: { description: "Admin access required" }
      }
    }
  },
  "/credits/products/{id}": {
    put: {
      tags: ["Credits"],
      summary: "Update a credit product (Admin only)",
      description: "Update credit product details and toggle active status",
      security: [{ Bearer: [] }],
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string", example: "64a1b4ff12345a6789abcdef" }
        }
      ],
      responses: {
        200: {
          description: "Credit product updated successfully",
          schema: { $ref: "#/definitions/CreditProduct" }
        },
        404: { description: "Credit product not found" },
        403: { description: "Admin access required" }
      }
    }
  },
  "/credits/checkout": {
    post: {
      tags: ["Credits"],
      summary: "Create Stripe checkout session for credit purchase",
      description: "Create a Stripe Checkout session for purchasing SMS/Email credits",
      security: [{ Bearer: [] }],
      parameters: [
        {
          name: "priceId",
          in: "body",
          required: true,
          schema: { type: "string", example: "price_1234567890" }
        }
      ],
      responses: {
        200: {
          description: "Checkout session created successfully",
          schema: { $ref: "#/definitions/CheckoutSession" }
        },
        400: { description: "priceId is required" },
        404: { description: "Business not found" }
      }
    }
  },
};

// Add route documentation to doc object
doc.paths = routeDocs;

swaggerAutogen(outputFile, endpointsFiles, doc).then(() => {
  console.log("Swagger documentation has been generated");
});
