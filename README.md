# You-Calendy Backend (BE-boilerplate)

## Recent Updates & Changes

### **Latest Features Added (2024)**

#### **1. Google Cloud Translation API Integration**

- **Multi-language Support**: Complete translation system using Google Cloud Translation API
- **MongoDB Caching**: Efficient translation caching to minimize API calls and costs
- **Frontend Integration**: Language selector with cookie persistence for seamless UX
- **Security**: Secure credential management with service account restrictions
- **API Endpoint**: `POST /api/translate` for text translation requests

#### **2. Enhanced Business Profile Management**

- **Personal Information Fields**: Added `personalName` and `surname` fields to business model
- **Complete Profile Updates**: New `PUT /api/business` endpoint for comprehensive business profile updates
- **Flexible Updates**: Support for partial updates of business information
- **Backward Compatibility**: Existing businesses remain unaffected

#### **3. Improved Client Onboarding System**

- **Two-Step Process**: Streamlined client creation with phone-only initial setup
- **SMS Invitations**: Automated invitation system for profile completion
- **Staff Association**: Direct staff assignment during client creation
- **Profile Completion Enforcement**: Appointment booking restrictions for incomplete profiles
- **Enhanced Invitation Links**: Rich business information in client invitation responses

#### **4. Haircut Gallery Enhancements**

- **Image Upload Support**: Suggestions and reports now support single image uploads
- **Rating System**: Reports can include ratings (1-5) for better feedback
- **Enhanced Schema**: New fields for `imageUrl`, `imagePublicId`, and `rating`
- **Better Moderation**: Improved content moderation with visual feedback

#### **5. Translation System Architecture**

- **Google Cloud Setup**: Complete setup guide for Google Cloud Translation API
- **Caching Mechanism**: MongoDB-based translation cache for performance optimization
- **Frontend Integration**: Language selector component with cookie persistence
- **Error Handling**: Robust error handling with fallback to original text
- **Security Best Practices**: Secure credential management and API restrictions

#### **6. Credit Management System**

- **SMS & Email Credits**: Comprehensive credit system for SMS and Email operations
- **Credit Validation**: Automatic credit checking before sending messages
- **Credit Deduction**: Real-time credit deduction for all messaging operations
- **Credit Purchase**: Stripe-integrated credit purchase system
- **Campaign Protection**: Credit validation for bulk SMS and Email campaigns
- **Appointment Notifications**: Credit-aware SMS for appointment reminders and review requests
- **Client Invitations**: Credit validation for client invitation SMS
- **Middleware Support**: Express middleware for credit validation
- **Non-Disruptive Implementation**: Only SMS/Email features affected by credit validation
- **Graceful Error Handling**: Proper HTTP 402 responses with consistent error structures
- **Audit Trail**: Complete credit usage tracking and logging

#### **7. Barber Link System**

- **Automatic Link Generation**: Unique barber profile links created during registration
- **Comprehensive Profile Data**: Includes business details, services, staff, appointment stats, and more
- **Public Access**: Anyone with the link can view barber profile (no authentication required)
- **Access Tracking**: Monitors link usage with access count and timestamps
- **Link Management**: Barbers can view and regenerate their profile links
- **Security**: Unique tokens prevent unauthorized access
- **Rich Data Display**: Complete business information including contact details, hours, services, and images
- **Professional Presence**: Showcases barber's business for client engagement

#### **8. Service-Specific Time Interval Management System (Major Update)**

- **Service-Specific Time Intervals**: Time intervals are now managed per staff-service relationship rather than globally per service. Each staff member can have different time intervals for different services.
- **Flexible Service Assignment**: When assigning services to staff, you provide both the service ID and the specific time interval for that service.
- **Dynamic Slot Generation**: Time slots are generated based on service-specific time intervals when a `serviceId` is provided, or default staff interval when no service is specified.
- **Enhanced Service Management**: Services no longer have duration fields - duration is now determined by the staff-service time interval relationship.
- **Break Period Management**: Staff can define break periods within shifts (e.g., lunch 12:00-13:00) that block appointment booking during specified times.
- **Schedule Replication**: Bulk replication of working hours from one day to multiple days with optional overwrite of existing schedules.
- **Enhanced Endpoints**:
  - `GET /api/business/staff/:staffId/working-hours?date=YYYY-MM-DD[&serviceId=...]` - Get available slots with service-specific intervals
  - `POST /api/business/staff/:staffId/replicate-schedule` - Replicate schedule across days
  - Enhanced `POST/PUT /api/business/staff` with service-specific time interval support
  - Updated `POST/PUT /api/services` without duration requirements

#### **9. Booking Buffer & Past Time Validation System**

- **Booking Buffer Configuration**: Each staff member can configure a `bookingBuffer` (0-1440 minutes) to prevent last-minute appointments
- **Past Time Prevention**: Automatic filtering of past time slots to prevent impossible appointments
- **Smart Time Slot Filtering**: Available slots automatically exclude past times and slots within the booking buffer
- **Flexible Buffer Settings**: Staff-specific buffer settings with business-wide defaults
- **Real-time Validation**: Appointment creation validates both past time and booking buffer requirements
- **Enhanced User Experience**: Clear error messages when booking requirements aren't met
- **API Integration**: All appointment-related endpoints respect booking buffer and past time validation
- **Key Features**:
  - **Booking Buffer**: If barber sets 30-minute buffer and current time is 3:05 PM, 3:30 PM and earlier slots are unavailable
  - **Past Time Prevention**: Any appointment time that has already passed is automatically filtered out
  - **Staff-Specific Settings**: Each staff member can have their own booking buffer configuration
  - **Business Defaults**: Business-wide default booking buffer settings
  - **Real-time Updates**: Time slot availability updates in real-time based on current time

#### **10. Client Phone Management & Custom Messaging System**

- **Client Phone Retrieval**: Simple endpoint to retrieve all client phone numbers for a business owner
- **Bulk Custom Messaging**: Send custom messages (email + SMS) to multiple selected clients simultaneously
- **Dual Channel Communication**: Messages are sent via both email and SMS to ensure maximum reach
- **Individual Result Tracking**: Per-client success/failure tracking for each message delivery
- **Graceful Error Handling**: Failed deliveries don't prevent other messages from being sent
- **Business Scoping**: All operations are scoped to the authenticated business owner's clients only
- **Active Client Filtering**: Only active clients receive messages
- **Delivery Summary**: Comprehensive summary of successful email and SMS deliveries
- **API Endpoints**:
  - `GET /api/business/clients/phones-simple` - Get all client phone numbers
  - `POST /api/business/clients/messages` - Send custom message to selected clients

#### **11. Multiple Discounts System (Promotions & Flash Sales)**

- **Concurrent Discounts**: Barbers can now activate multiple discounts (flash sales and promotions) simultaneously
- **Confirmation Mechanism**: When activating a new discount while another is active, a confirmation prompt appears
- **User-Friendly Warnings**: Clear warning messages inform barbers about existing active discounts before activation
- **Flexible Discount Management**: No restrictions on overlapping discounts - barbers have full control
- **Appointment Integration**: Appointment creation automatically applies the best discount (flash sales take precedence over promotions)
- **API Response**: Returns HTTP 409 with detailed information about existing discounts when confirmation is needed
- **Confirmation Parameter**: `confirmMultiple: true` parameter allows bypassing the warning after user confirmation
- **Backward Compatible**: Existing discount logic remains unchanged, only overlap prevention removed
- **API Endpoints**:
  - `POST /api/flash-sales` - Create flash sale (with `confirmMultiple` parameter)
  - `PUT /api/flash-sales/:id` - Update flash sale (with `confirmMultiple` parameter)
  - `POST /api/promotions` - Create promotion (with `confirmMultiple` parameter)
  - `PUT /api/promotions/:id` - Update promotion (with `confirmMultiple` parameter)

---

## Service-Specific Time Interval Management System

### Overview

The Service-Specific Time Interval Management System represents a major architectural change that moves time interval management from services to staff-service relationships. This allows for more flexible scheduling where each staff member can have different time intervals for different services, providing better customization and control over appointment scheduling.

### Key Changes

#### **1. Service Model Changes**

**Before:**

```javascript
// Service had duration field
{
  name: "Haircut",
  duration: {
    hours: 1,
    minutes: 30
  },
  price: 25
}
```

**After:**

```javascript
// Service no longer has duration
{
  name: "Haircut",
  price: 25,
  currency: "USD",
  category: "Hair"
}
```

#### **2. Staff Model Changes**

**Before:**

```javascript
// Staff had global timeInterval and simple services array
{
  firstName: "John",
  lastName: "Doe",
  timeInterval: 30, // Global for all services
  services: ["serviceId1", "serviceId2"] // Simple array
}
```

**After:**

```javascript
// Staff has service-specific time intervals
{
  firstName: "John",
  lastName: "Doe",
  timeInterval: 15, // Default fallback interval
  services: [
    {
      service: "serviceId1",
      timeInterval: 30 // Specific interval for this service
    },
    {
      service: "serviceId2",
      timeInterval: 45 // Different interval for this service
    }
  ]
}
```

#### **Backup/Restore Compatibility Note**
- Older backups created before this change may store `staff.services` as plain strings or string arrays (service IDs).
- The restore process now automatically normalizes legacy `staff.services` into the embedded shape `{ service: ObjectId, timeInterval }` using the staff's default `timeInterval` if a specific one is missing.
- This prevents restore failures like `Cast to embedded failed at path "services" (ObjectParameterError)` when restoring older backups.
- To locally verify normalization, run: `node you-calendy-be/src/scripts/test-restore-normalization.js`.

### API Changes

#### **1. Service Management**

**Create Service (Updated):**

```bash
POST /api/services
{
  "name": "Haircut",
  "description": "Basic haircut service",
  "price": 25,
  "category": "Hair",
  "currency": "USD"
}
```

**Update Service (Updated):**

```bash
PUT /api/services/:id
{
  "name": "Updated Haircut",
  "description": "Updated description",
  "price": 30,
  "category": "Hair",
  "isActive": true
}
```

#### **2. Staff Management**

**Add Staff Member (Updated):**

```bash
POST /api/business/staff
{
  "firstName": "John",
  "lastName": "Doe",
  "email": "john.doe@example.com",
  "phone": "+1234567890",
  "role": "Barber",
  "position": "Senior Barber",
  "services": [
    { "service": "serviceId1", "timeInterval": 30 },
    { "service": "serviceId2", "timeInterval": 45 }
  ],
  "bookingBuffer": 30,
  "workingHours": [
    {
      "day": "monday",
      "enabled": true,
      "shifts": [
        {
          "start": "09:00",
          "end": "17:00",
          "breaks": [
            {
              "start": "12:00",
              "end": "13:00"
            }
          ]
        }
      ]
    }
  ]
}
```

**Update Staff Member (Updated):**

```bash
PUT /api/business/staff/:staffId
{
  "firstName": "John",
  "lastName": "Doe",
  "services": [
    { "service": "serviceId1", "timeInterval": 30 },
    { "service": "serviceId2", "timeInterval": 45 }
  ],
  "bookingBuffer": 45
}
```

#### **3. Working Hours & Time Slots**

**Get Available Time Slots:**

```bash
# Get all possible slots based on default timeInterval
GET /api/business/staff/:staffId/working-hours?date=2024-01-15

# Get service-specific slots based on service timeInterval
GET /api/business/staff/:staffId/working-hours?date=2024-01-15&serviceId=serviceId1
```

**Response Example:**

```json
{
  "success": true,
  "data": {
    "staff": {
      "_id": "staffId",
      "firstName": "John",
      "lastName": "Doe",
      "timeInterval": 15,
      "bookingBuffer": 30,
      "workingHours": [
        {
          "day": "monday",
          "enabled": true,
          "shifts": [
            {
              "start": "09:00",
              "end": "17:00",
              "breaks": [
                {
                  "start": "12:00",
                  "end": "13:00"
                }
              ]
            }
          ],
          "availableSlots": [
            "09:00",
            "09:15",
            "09:30",
            "09:45",
            "10:00",
            "10:15",
            "10:30",
            "10:45",
            "11:00",
            "11:15",
            "11:30",
            "11:45",
            "13:00",
            "13:15",
            "13:30",
            "13:45",
            "14:00",
            "14:15",
            "14:30",
            "14:45",
            "15:00",
            "15:15",
            "15:30",
            "15:45",
            "16:00",
            "16:15",
            "16:30",
            "16:45"
          ]
        }
      ]
    }
  }
}
```

### Time Slot Generation Logic

#### **1. Default Time Slots (No serviceId)**

- Uses staff's default `timeInterval` (e.g., 15 minutes)
- Generates slots every 15 minutes: 09:00, 09:15, 09:30, etc.
- Excludes break periods and booked appointments
- Filters out past time slots and respects booking buffer

#### **2. Service-Specific Time Slots (With serviceId)**

- Uses the specific `timeInterval` for that service (e.g., 30 minutes)
- Generates slots every 30 minutes: 09:00, 09:30, 10:00, etc.
- Only includes slots that can accommodate the full service duration
- Excludes break periods, booked appointments, past times, and booking buffer

### Validation & Error Handling

#### **Service Time Interval Validation**

```javascript
// Validates service-specific time intervals
const validateServiceTimeIntervals = async (services) => {
  for (const serviceItem of services) {
    const { service, timeInterval } = serviceItem;

    if (!service || !timeInterval) {
      return {
        isValid: false,
        message: "Service ID and time interval are required",
      };
    }

    if (timeInterval < 5 || timeInterval > 120) {
      return {
        isValid: false,
        message: "Time interval must be between 5 and 120 minutes",
      };
    }
  }

  return { isValid: true };
};
```

#### **Error Responses**

```json
{
  "success": false,
  "message": "Invalid service time intervals found:",
  "statusCode": 400,
  "invalidServices": [
    {
      "serviceId": "serviceId1",
      "timeInterval": 3,
      "error": "Time interval must be between 5 and 120 minutes"
    }
  ]
}
```

### Appointment Creation Changes

#### **Duration Calculation**

```javascript
// Calculate duration from staff-service relationship
let serviceDurationMinutes = duration; // Use provided duration if available

if (!serviceDurationMinutes && staffId) {
  // Get from staff-service relationship
  const staff = await Staff.findById(staffId);
  if (staff) {
    const serviceItem = staff.services.find(
      (s) => s.service.toString() === serviceId
    );
    if (serviceItem) {
      serviceDurationMinutes = serviceItem.timeInterval;
    }
  }
}

// Fallback to default duration
if (!serviceDurationMinutes) {
  serviceDurationMinutes = 60; // Default 60 minutes
}
```

### Migration Considerations

#### **Backward Compatibility**

- Existing appointments continue to work with stored duration values
- Services without duration fields are handled gracefully
- Default time intervals are used when service-specific intervals are not available
- Fallback mechanisms ensure system stability

#### **Data Migration**

- Existing services: Duration fields removed, no data loss
- Existing staff: Global timeInterval preserved as default
- Existing appointments: Duration values remain unchanged
- New staff-service assignments: Require explicit time interval specification

### Benefits

#### **1. Flexibility**

- Each staff member can have different time intervals for different services
- Better customization for different service types
- More accurate scheduling based on actual service requirements

#### **2. Accuracy**

- Time slots are generated based on actual service duration
- No more conflicts between service duration and time intervals
- More precise appointment scheduling

#### **3. Scalability**

- Easy to add new services without duration constraints
- Staff can be assigned to services with appropriate time intervals
- Better resource utilization

#### **4. User Experience**

- More accurate available time slots
- Better appointment booking experience
- Clearer service-staff relationships

### Example Use Cases

#### **1. Hair Salon**

```javascript
// Staff member with different intervals for different services
{
  "firstName": "Sarah",
  "services": [
    { "service": "haircut", "timeInterval": 30 },      // 30-min haircut
    { "service": "coloring", "timeInterval": 90 },      // 90-min coloring
    { "service": "styling", "timeInterval": 45 }       // 45-min styling
  ]
}
```

#### **2. Barber Shop**

```javascript
// Staff member with different intervals for different services
{
  "firstName": "Mike",
  "services": [
    { "service": "basic_cut", "timeInterval": 20 },    // 20-min basic cut
    { "service": "beard_trim", "timeInterval": 15 },   // 15-min beard trim
    { "service": "full_service", "timeInterval": 60 }  // 60-min full service
  ]
}
```

### API Endpoints Summary

#### **Service Management**

- `POST /api/services` - Create service (no duration required)
- `PUT /api/services/:id` - Update service (no duration handling)
- `GET /api/services` - List services (no duration in response)
- `DELETE /api/services/:id` - Delete service

#### **Staff Management**

- `POST /api/business/staff` - Add staff with service-specific intervals
- `PUT /api/business/staff/:staffId` - Update staff with service-specific intervals
- `GET /api/business/staff` - List staff members
- `GET /api/business/staff/:staffId` - Get staff details
- `DELETE /api/business/staff/:staffId` - Delete staff member

#### **Working Hours & Scheduling**

- `GET /api/business/staff/:staffId/working-hours` - Get available time slots
- `POST /api/business/staff/:staffId/replicate-schedule` - Replicate schedule

#### **Appointment Management**

- `POST /api/appointments` - Create appointment (uses service-specific duration)
- `PUT /api/appointments/:id` - Update appointment
- `GET /api/appointments/available` - Get available slots

### Testing

#### **Test Scenarios**

1. **Service Creation**: Verify services can be created without duration
2. **Staff Assignment**: Verify staff can be assigned services with specific time intervals
3. **Time Slot Generation**: Verify slots are generated based on service-specific intervals
4. **Appointment Creation**: Verify appointments use correct duration from staff-service relationship
5. **Validation**: Verify time interval validation works correctly
6. **Fallback**: Verify fallback mechanisms work when data is missing

#### **Test Data**

```javascript
// Test service creation
const service = {
  name: "Test Haircut",
  price: 25,
  category: "Hair",
};

// Test staff creation with service-specific intervals
const staff = {
  firstName: "Test",
  lastName: "Barber",
  services: [
    { service: "serviceId1", timeInterval: 30 },
    { service: "serviceId2", timeInterval: 45 },
  ],
};
```

---

## Barber Link System

### Overview

The Barber Link System provides a comprehensive solution for barbers to share their professional profiles with clients through unique, shareable links. Upon successful registration, each barber automatically receives a unique link containing all relevant business details, services, appointment information, and barber-related data. This system enables easy client engagement and professional presence showcasing.

---

### 1. Automatic Link Generation

#### **Registration Integration**

- **Automatic Creation**: Barber links are generated automatically during the registration process
- **Unique Tokens**: Each link uses a secure, unique token generated using cryptographic functions
- **Business Association**: Links are directly associated with the barber's business record
- **Non-Breaking**: Link generation failure doesn't affect the registration process

#### **Link Format**

```
https://yourapp.com/barber/profile/abc123def456
```

#### **Registration Response**

```json
{
  "token": "jwt_token",
  "user": {
    /* user details */
  },
  "business": {
    /* business details */
  },
  "barberLink": "https://yourapp.com/barber/profile/abc123def456",
  "signup": true
}
```

---

### 2. Comprehensive Profile Data

#### **Barber Information**

- **Personal Details**: Name, email, phone, profile image
- **Business Information**: Business name, contact details, address, location
- **Operating Hours**: Complete business hours with multiple shifts per day
- **Services Offered**: All business services with pricing and duration
- **Staff Members**: Available staff with their services and details
- **Business Images**: Logo, workplace photos, gallery images
- **Social Media**: Facebook, Instagram, Twitter, website links
- **Subscription Status**: Trial/subscription information

#### **Business Statistics**

- **Appointment Data**: Total appointments, completed appointments
- **Revenue Information**: Total revenue from completed appointments
- **Performance Metrics**: Average rating, completion rates
- **Link Analytics**: Access count, last accessed timestamp

#### **Complete Response Structure**

```json
{
  "barber": {
    "_id": "barber_id",
    "name": "John Doe",
    "email": "john@example.com",
    "phone": "+1234567890",
    "profileImage": "https://example.com/profile.jpg"
  },
  "business": {
    "_id": "business_id",
    "name": "Professional Barbershop",
    "personalName": "John",
    "surname": "Doe",
    "contactInfo": {
      "email": "john@barbershop.com",
      "phone": "+1234567890",
      "publicUrl": "barbershop.com"
    },
    "address": {
      "streetName": "Main Street",
      "houseNumber": "123",
      "city": "New York",
      "postalCode": "10001"
    },
    "location": {
      "coordinates": [-73.935242, 40.73061],
      "address": "123 Main Street, New York, 10001"
    },
    "businessHours": {
      "monday": {
        "enabled": true,
        "shifts": [{ "start": "09:00", "end": "17:00" }]
      },
      "tuesday": {
        "enabled": true,
        "shifts": [{ "start": "09:00", "end": "17:00" }]
      }
    },
    "services": [
      {
        "name": "Haircut",
        "type": "Salon",
        "duration": { "hours": 1, "minutes": 0 },
        "price": 25,
        "currency": "USD"
      }
    ],
    "profileImages": {
      "logo": "https://example.com/logo.jpg",
      "workspacePhotos": ["https://example.com/workspace1.jpg"],
      "galleryImages": ["https://example.com/gallery1.jpg"]
    },
    "socialMedia": {
      "facebook": "fb.com/barbershop",
      "instagram": "instagram.com/barbershop",
      "twitter": "twitter.com/barbershop",
      "website": "barbershop.com"
    },
    "subscriptionStatus": "active",
    "trialStart": "2024-01-01T00:00:00Z",
    "trialEnd": null
  },
  "services": [
    {
      "name": "Haircut",
      "price": 25,
      "duration": { "hours": 1, "minutes": 0 },
      "currency": "USD"
    }
  ],
  "staff": [
    {
      "name": "Jane Smith",
      "services": ["Haircut", "Beard Trim"]
    }
  ],
  "stats": {
    "totalAppointments": 150,
    "completedAppointments": 120,
    "totalRevenue": 3000,
    "averageRating": 4.5
  },
  "linkInfo": {
    "accessCount": 25,
    "lastAccessedAt": "2024-01-15T10:30:00Z",
    "createdAt": "2024-01-01T00:00:00Z"
  }
}
```

---

### 3. API Endpoints

#### **Public Endpoints (No Authentication Required)**

- **`GET /api/barber/profile/:linkToken`** - Get comprehensive barber profile by link token

#### **Private Endpoints (Authentication Required)**

- **`GET /api/business/barber-link`** - Get current barber link for business
- **`POST /api/business/barber-link/regenerate`** - Regenerate barber link

#### **Usage Examples**

**Get Barber Profile (Public):**

```bash
GET /api/barber/profile/abc123def456
# Returns comprehensive barber profile data
```

**Get Current Barber Link (Private):**

```bash
GET /api/business/barber-link
Authorization: Bearer <jwt_token>
```

**Regenerate Barber Link (Private):**

```bash
POST /api/business/barber-link/regenerate
Authorization: Bearer <jwt_token>
```

---

### 4. Database Schema

#### **BarberLink Model**

```javascript
{
  business: ObjectId,        // Reference to Business
  linkToken: String,         // Unique token for the link
  isActive: Boolean,         // Link status
  expiresAt: Date,           // Optional expiration
  accessCount: Number,        // Track link usage
  lastAccessedAt: Date,      // Last access timestamp
  createdBy: ObjectId,       // User who created the link
  timestamps: true
}
```

#### **Key Features**

- **Unique Constraints**: Each business can only have one active barber link
- **Access Tracking**: Monitors link usage with automatic timestamp updates
- **Security**: Unique tokens prevent unauthorized access
- **Expiration Support**: Optional link expiration for enhanced security
- **Audit Trail**: Complete creation and access history

---

### 5. Security & Access Control

#### **Token Security**

- **Cryptographic Generation**: Uses `crypto.randomBytes(16).toString("hex")` for secure token generation
- **Unique Tokens**: Each link has a unique, non-guessable token
- **No Authentication Required**: Public access for client convenience
- **Business Isolation**: Links are isolated per business

#### **Access Validation**

- **Active Link Check**: Only active links can be accessed
- **Expiration Handling**: Expired links return appropriate error messages
- **Business Validation**: Ensures business exists and is valid
- **Error Handling**: Proper error responses for invalid or expired links

---

### 6. Link Management

#### **View Current Link**

Barbers can view their current barber link and access statistics:

```json
{
  "barberLink": "https://yourapp.com/barber/profile/abc123def456",
  "linkToken": "abc123def456",
  "accessCount": 25,
  "lastAccessedAt": "2024-01-15T10:30:00Z",
  "createdAt": "2024-01-01T00:00:00Z",
  "expiresAt": null
}
```

#### **Regenerate Link**

Barbers can regenerate their link for security purposes:

- **Old Link Deactivation**: Previous link is automatically deactivated
- **New Token Generation**: New secure token is generated
- **Immediate Availability**: New link is immediately available
- **Access Reset**: Access count resets for the new link

---

### 7. Integration Points

#### **Registration Flow**

- **Modified `authController.register()`**: Added barber link generation
- **Non-Breaking**: Link generation failure doesn't affect registration
- **Automatic**: No manual intervention required

#### **Business Management**

- **Added to `businessController.js`**: Barber link management endpoints
- **Route Integration**: Added to business router with proper authentication
- **Public Router**: Separate public router for barber profile access

#### **Database Integration**

- **New Model**: `BarberLink` model with proper indexing
- **Business Relationship**: Direct relationship with Business model
- **User Tracking**: Tracks who created the link

---

### 8. Frontend Integration

#### **Link Sharing**

Barbers can easily share their profile links:

- **Copy to Clipboard**: Simple copy functionality
- **Social Media**: Share on social platforms
- **Direct Messaging**: Send via SMS, email, or messaging apps
- **QR Codes**: Generate QR codes for easy access

#### **Client Experience**

Clients accessing barber links get:

- **Rich Profile Display**: Complete business information
- **Service Browsing**: View all available services
- **Contact Information**: Direct access to contact details
- **Business Hours**: See operating hours and availability
- **Professional Presentation**: High-quality business showcase

---

### 9. Analytics & Monitoring

#### **Access Tracking**

- **Access Count**: Track total number of link accesses
- **Last Accessed**: Timestamp of most recent access
- **Usage Patterns**: Monitor link usage over time
- **Performance Metrics**: Track engagement and conversion

#### **Business Insights**

- **Profile Views**: Monitor how often the profile is viewed
- **Client Engagement**: Track client interest in services
- **Marketing Effectiveness**: Measure link sharing success
- **Professional Presence**: Assess business visibility

---

### 10. Error Handling

#### **Invalid Link**

```json
{
  "success": false,
  "message": "Invalid or expired barber link",
  "statusCode": 404
}
```

#### **Expired Link**

```json
{
  "success": false,
  "message": "Barber link has expired",
  "statusCode": 404
}
```

#### **Business Not Found**

```json
{
  "success": false,
  "message": "Business not found",
  "statusCode": 404
}
```

---

### 11. Best Practices

#### **Link Management**

- **Regular Regeneration**: Regenerate links periodically for security
- **Monitor Usage**: Track access patterns and engagement
- **Professional Presentation**: Ensure business information is complete and accurate
- **Client Communication**: Use links in marketing and client communication

#### **Security**

- **Token Confidentiality**: Keep link tokens secure and private
- **Access Monitoring**: Monitor for unusual access patterns
- **Regular Updates**: Update business information regularly
- **Professional Image**: Maintain high-quality business presentation

---

### 12. Benefits

#### **For Barbers**

- **Easy Sharing**: Simple way to share professional profile
- **Client Engagement**: Increase client interest and bookings
- **Professional Presence**: Showcase business professionally
- **Marketing Tool**: Use as marketing and promotional material
- **Analytics**: Track profile views and engagement

#### **For Clients**

- **Easy Access**: No login required to view barber profile
- **Complete Information**: Access to all business details
- **Service Browsing**: View all available services and pricing
- **Contact Information**: Direct access to contact details
- **Professional Experience**: High-quality business presentation

#### **For Platform**

- **User Engagement**: Increase platform usage and engagement
- **Professional Network**: Build professional barber network
- **Client Acquisition**: Help barbers acquire new clients
- **Platform Value**: Add significant value to the platform
- **Competitive Advantage**: Unique feature for market differentiation

---

## Translation Functionality (Google Cloud Translation API)

### Overview

This project supports multi-language translation for user-facing content using the Google Cloud Translation API. The integration is secure, efficient, and scalable, leveraging a MongoDB cache to minimize API calls and a frontend language selector with cookie persistence for a seamless user experience.

---

### 1. Google Cloud Project Setup

1. **Create a Google Cloud Project:**

   - Go to the [Google Cloud Console](https://console.cloud.google.com/).
   - Create a new project or select an existing one.

2. **Enable the Cloud Translation API:**

   - In the Cloud Console, navigate to "APIs & Services" > "Library".
   - Search for "Cloud Translation API" and enable it for your project.

3. **Create a Service Account:**

   - Go to "APIs & Services" > "Credentials".
   - Click "Create Credentials" > "Service account".
   - Grant it the "Cloud Translation API User" role.
   - Download the JSON key file and save it securely (e.g., `gcloud-translate-key.json`).
   - **Never commit this file to version control.**

4. **Restrict the Service Account:**

   - Restrict the service account to your backend server's IP/domain for security.

5. **Configure Environment Variables:**
   - Add the following to your `src/config/config.env`:
     ```env
     GCLOUD_PROJECT_ID=your-google-cloud-project-id
     GCLOUD_TRANSLATE_KEYFILE=path/to/gcloud-translate-key.json
     ```

---

### 2. Install the Google Cloud Translation Package

Install the official package in your backend:

```bash
npm install @google-cloud/translate
```

---

### 3. Backend Implementation

#### a. MongoDB Translation Cache

- **Model:** `src/models/translationCache.js`
- **Fields:** `originalText`, `targetLang`, `translatedText`, `sourceLang`, `lastUsed`
- **Purpose:** Stores translations to avoid redundant API calls and improve performance.
- **Index:** Unique on `originalText` + `targetLang` for fast lookups.

#### b. Translator Utility

- **File:** `src/utils/translator.js`
- **Logic:**
  - Checks the cache for an existing translation.
  - If not found, calls Google Cloud Translation API.
  - Stores the result in MongoDB for future use.
  - Handles batch and single translations.
  - Falls back to the original text if translation fails.

#### c. Express Route: `/api/translate`

- **Route:** `POST /api/translate`
- **Controller:** `src/controllers/translateController.js`
- **Request Body:** `{ text: 'Text to translate', targetLang: 'es' }`
- **Response:** `{ translated: 'Texto traducido' }`
- **Flow:**
  1. Receives translation request from frontend.
  2. Uses the translator utility to check cache or call Google API.
  3. Returns the translated text.
- **Error Handling:** Uses project-wide `SuccessHandler` and `ErrorHandler` for consistent responses.

---

### 4. Frontend Integration

#### a. Language Selector Component

- **UI:** Dropdown for language selection (e.g., English, Español, Français, etc.).
- **Persistence:** Uses cookies (e.g., with `js-cookie`) to remember the user's language preference for 1 year.
- **Usage:**

  - On change, updates the cookie and (optionally) reloads the app or updates context.
  - Example:

    ```jsx
    import React, { useEffect, useState } from "react";
    import Cookies from "js-cookie";

    const LANGUAGES = [
      { code: "en", label: "English" },
      { code: "es", label: "Español" },
      { code: "fr", label: "Français" },
      // ...
    ];

    export default function LanguageSelector() {
      const [lang, setLang] = useState(Cookies.get("lang") || "en");
      useEffect(() => {
        Cookies.set("lang", lang, { expires: 365 });
        // Optionally reload or update context here
      }, [lang]);
      return (
        <select value={lang} onChange={(e) => setLang(e.target.value)}>
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
      );
    }
    ```

#### b. Using the Translation API from the Frontend

- **API Call Example:**
  ```js
  async function translate(text, targetLang) {
    const res = await fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, targetLang }),
    });
    const data = await res.json();
    return data.translated;
  }
  ```
- **Integration:** Use the selected language from the cookie to translate UI strings or user-generated content as needed.

---

### 5. MongoDB Caching Mechanism

- **How it Works:**
  - When a translation is requested, the backend first checks the `TranslationCache` collection.
  - If a cached translation exists, it is returned immediately and the `lastUsed` timestamp is updated.
  - If not, the backend calls the Google Cloud Translation API, stores the result in the cache, and returns it.
- **Benefits:**
  - **Performance:** Reduces latency for repeated translations.
  - **Cost:** Minimizes Google API usage, saving on quota and billing.
  - **Scalability:** Ensures the system can handle high translation loads efficiently.

---

### 6. End-to-End Flow

1. **User selects a language** using the frontend language selector. The preference is stored in a cookie.
2. **Frontend sends translation requests** to `/api/translate` with the text and the selected language code.
3. **Backend checks the MongoDB cache** for the translation. If found, it returns the cached result.
4. **If not cached,** the backend calls the Google Cloud Translation API, stores the result in MongoDB, and returns the translation.
5. **The translated text is displayed** to the user in their preferred language.

---

### 7. Security & Best Practices

- **Google Cloud credentials are never exposed to the frontend.**
- **Service account is restricted to backend IP/domain.**
- **All API calls use HTTPS.**
- **Translations are cached in MongoDB for efficiency.**
- **Fallback to English if translation fails.**
- **Controller and route structure follows project conventions for maintainability.**

---

## Credit Management System

### Overview

The credit management system ensures that SMS and Email sending operations consume credits from the business's credit balance. When credits run out, the system prevents further sending until new credits are purchased. This system provides comprehensive credit validation, deduction, and purchase functionality integrated throughout the platform.

---

### 1. Credit Storage & Management

#### **Business Model Integration**

- **SMS Credits**: `smsCredits` field in business model stores available SMS credits
- **Email Credits**: `emailCredits` field in business model stores available Email credits
- **Credit Isolation**: Credits are isolated per business with no cross-business access
- **Real-time Updates**: Credit balances are updated in real-time during operations

#### **Credit Manager Utility** (`src/utils/creditManager.js`)

Core utility functions for all credit operations:

- `checkSmsCredits(businessId, requiredCredits)` - Validate SMS credit availability
- `checkEmailCredits(businessId, requiredCredits)` - Validate Email credit availability
- `deductSmsCredits(businessId, creditsToDeduct)` - Deduct SMS credits from business
- `deductEmailCredits(businessId, creditsToDeduct)` - Deduct Email credits from business
- `addSmsCredits(businessId, creditsToAdd)` - Add SMS credits (for purchases)
- `addEmailCredits(businessId, creditsToAdd)` - Add Email credits (for purchases)
- `validateAndDeductSmsCredits()` - Validate and deduct with error handling
- `validateAndDeductEmailCredits()` - Validate and deduct with error handling
- `getBusinessCredits(businessId)` - Retrieve current credit balance

---

### 2. Credit-Aware Messaging System

#### **Wrapper Functions** (`src/utils/creditAwareMessaging.js`)

Credit-aware messaging functions that handle validation before sending:

- `sendSMSWithCredits(to, body, businessId, req, res)` - Send single SMS with credit validation
- `sendEmailWithCredits(email, subject, content, businessId, req, res)` - Send single Email with credit validation
- `sendBulkSMSWithCredits(recipients, body, businessId, req, res)` - Send multiple SMS with credit validation
- `sendBulkEmailWithCredits(recipients, subject, content, businessId, req, res)` - Send multiple Emails with credit validation
- `checkBulkCredits(businessId, smsCount, emailCount)` - Validate credits for bulk operations

#### **Integration Points**

- **SMS Campaigns**: All SMS campaigns validate and deduct credits before sending
- **Email Campaigns**: All Email campaigns validate and deduct credits before sending
- **Message Blasts**: Email blasts validate credits before sending to recipient groups
- **Appointment Notifications**: SMS reminders and review requests validate credits
- **Client Invitations**: Invitation SMS validates credits before sending
- **Scheduled Operations**: Scheduled campaigns deduct credits when processed

---

### 3. Credit Middleware System

#### **Express Middleware** (`src/middleware/creditMiddleware.js`)

Middleware functions for consistent credit validation:

- `checkSmsCredits(requiredCredits)` - Check SMS credits before operations
- `checkEmailCredits(requiredCredits)` - Check Email credits before operations
- `checkBothCredits(smsCredits, emailCredits)` - Check both SMS and Email credits
- `checkCreditsByRecipientCount(recipientField, creditType)` - Check credits based on recipient count
- `getBusinessCredits()` - Get business credit information without validation

#### **Usage Examples**

```javascript
// Check SMS credits before campaign
router.post("/sms-campaign", checkSmsCredits(10), createSmsCampaign);

// Check both SMS and Email credits
router.post("/mixed-campaign", checkBothCredits(5, 3), createMixedCampaign);

// Check credits based on recipient count
router.post(
  "/bulk-sms",
  checkCreditsByRecipientCount("recipientCount", "sms"),
  sendBulkSMS
);
```

---

### 4. Credit Purchase System

#### **Credit Products** (`src/models/creditProduct.js`)

- Products define SMS and Email credit bundles
- Linked to Stripe products and prices for seamless purchasing
- Support for different credit packages and pricing tiers

#### **Purchase Flow** (`src/controllers/creditsController.js`)

- `createCheckoutSession()` - Creates Stripe checkout session for credit purchase
- `getBusinessCredits()` - Returns current credit balance
- Integration with Stripe webhooks for automatic credit addition

#### **Webhook Processing** (`src/controllers/webhookController.js`)

- `handleStripeWebhook()` - Processes successful credit purchases
- Automatically adds purchased credits to business account
- Handles failed payments and refunds

---

### 5. API Endpoints

#### **Credit Management**

- `GET /api/business/credits` - Get current credit balance
- `POST /api/business/check-campaign-credits` - Check credits for campaigns
- `POST /api/credits/checkout-session` - Create checkout session for credit purchase

#### **Credit-Protected Operations**

- `POST /api/business/sms-campaigns` - Create SMS campaign (validates credits)
- `POST /api/business/email-campaigns` - Create Email campaign (validates credits)
- `POST /api/business/message-blast/email` - Send email blast (validates credits)
- `POST /api/business/clients` - Add client with invitation SMS (validates credits)
- `PUT /api/appointments/:id/status` - Update appointment with SMS notifications (validates credits)

---

### 6. Error Handling & User Experience

#### **Insufficient Credits Response (HTTP 402)**

```json
{
  "success": false,
  "message": "Insufficient SMS credits. Required: 10, Available: 5. Please purchase more credits to continue.",
  "statusCode": 402
}
```

#### **Credit Validation Flow**

1. Check if business has sufficient credits
2. If insufficient, return HTTP 402 error response
3. If sufficient, deduct credits and proceed with operation
4. Log credit usage for audit purposes

#### **Graceful Degradation**

- Critical operations (appointment updates) don't fail due to credit issues
- Credit failures are logged for monitoring
- Fallback behavior provided when appropriate

---

### 7. Monitoring & Analytics

#### **Credit Usage Tracking**

- All credit deductions logged with business ID and amount
- Campaign metadata includes `creditsUsed` field
- Failed credit validations logged with detailed error messages

#### **Audit Trail**

- Credit purchases tracked through Stripe webhooks
- Credit usage logged in campaign metadata
- Business credit balance changes logged
- Complete audit trail for compliance and monitoring

---

### 8. Security & Best Practices

#### **Credit Protection**

- Credits validated server-side only
- Client-side credit checks for UX only
- All credit operations require authentication
- Business isolation prevents cross-business credit access

#### **Best Practices**

- Always validate credits before bulk operations
- Use middleware for consistent credit checking
- Provide clear error messages when credits insufficient
- Show current credit balance in UI
- Warn users before running out of credits
- Provide easy access to credit purchase flow

---

### 9. Testing & Validation

#### **Test Scenarios**

1. **Sufficient Credits**: Verify normal operation with adequate credits
2. **Insufficient Credits**: Verify error handling when credits are low
3. **Credit Purchase**: Verify credits added after successful purchase
4. **Bulk Operations**: Verify credit validation for multiple recipients
5. **Scheduled Operations**: Verify credit deduction for scheduled campaigns

#### **Test Script**

Run the provided test script to validate credit system functionality:

```bash
node test_credit_system.js
```

---

## Project Overview

You-Calendy is a comprehensive backend API for a business appointment scheduling platform. It enables businesses to manage services, staff, clients, appointments, and now subscription plans, while providing authentication, notifications, business management features, advanced analytics, email marketing, SMS campaigns, promotions, flash sales, support system, and more. The backend is built with Node.js, Express, and MongoDB, and is designed for extensibility and integration with a frontend client.

---

## Core Features

### **User Authentication & Management**

- Register, login, JWT-based authentication, password reset, and profile management
- Role-based access control (business owners, staff, clients, admin)
- Email verification and password recovery
- Profile settings with notification preferences
- Device token management for push notifications

### **Business Management**

- CRUD operations for business info, address, hours, and services
- **Enhanced Profile Management**: Complete business profile updates with personal information fields (`personalName`, `surname`)
- **Flexible Updates**: Support for partial updates of business information via `PUT /api/business`
- Business settings management (logo, workplace photos, gallery images)
- Business hours configuration with multiple shifts per day
- Service categorization and pricing management
- **Freemium-to-Premium Model**: 2-week free trial with Stripe subscription integration

### **Plan Management**

- **Create, update, delete, and list subscription plans**
- **Stripe Integration**: Plans are synced with Stripe products/prices for billing

### **Service & Staff Management**

- **Service-Specific Time Intervals**: Create, update, delete, and categorize services without duration constraints. Time intervals are now managed per staff-service relationship for maximum flexibility.
- **Staff Management**: Staff management with working hours, service assignments with specific time intervals, and availability tracking.
- **Service Assignment**: When assigning services to staff, specify both the service ID and the time interval for that specific service.
- **Dynamic Time Slot Generation**: Time slots are generated based on service-specific time intervals when a service is selected, or default staff interval when no service is specified.
- **Staff Scheduling**: Staff scheduling and calendar integration with service-specific time intervals.
- **Staff Performance Tracking**: Staff performance tracking and analytics with service-specific metrics.
- **Enhanced Working Hours System**: Each staff member can define service-specific time intervals (5-120 minutes) controlling slot granularity, break periods within shifts, and schedule replication across days.
- **Break Period Management**: Staff can define break periods (e.g., lunch breaks) that block appointment booking during specified times.
- **Schedule Replication**: Bulk replication of working hours from one day to multiple days with optional overwrite functionality.
- **Working Hours API**: `GET /api/business/staff/:staffId/working-hours?date=YYYY-MM-DD[&serviceId=...]` returns dynamically generated slots per shift based on service-specific time intervals, excluding break periods and booked times.

### **Appointment Scheduling System**

- Book, update, cancel, and view appointments with conflict detection
- Check available time slots based on business hours and staff availability
- **Booking Buffer System**: Prevent last-minute appointments with configurable advance booking requirements
- **Past Time Validation**: Automatic filtering of past time slots to prevent impossible appointments
- **Smart Time Slot Filtering**: Real-time availability updates based on current time and booking buffer settings
- Appointment status management (Pending, Confirmed, Completed, Canceled, No-Show, Missed)
- Manual appointment creation by barbers with custom pricing
- Appointment history and analytics
- Revenue projection and business performance metrics

### **Client Management**

**_Rationale for Change:_**
To streamline client onboarding and improve data quality, the client creation flow now uses a two-step process: barbers add clients with only a phone number, and clients complete their profiles via a secure SMS invitation link. This ensures accurate client data, reduces friction for barbers, and enables automated reminders and marketing features.

#### **New Two-Step Client Onboarding Flow (with Staff Selection)**

1. **Barber adds client with phone number and selects a staff member** via `POST /api/business/clients`.
2. **System generates a unique invitation token** and sends an SMS with a secure link to the client.
3. **Client receives SMS** and completes their profile (first name, last name, email) via `POST /api/client/complete-profile`.
4. **Staff association is saved**: The selected staff member (`staffId`) is stored in the client record.
5. **Client is marked as `isProfileComplete: true`** and can now be booked for appointments.
6. **Barber cannot book appointments for incomplete clients** (enforced in backend logic).
7. **Barber can resend the invitation SMS** if needed via `POST /api/business/clients/:clientId/resend-invitation`.
8. **When the client opens the invitation link**, their details (including staffId and staff info) are fetched using the invitation token. The API response includes the staff field populated with staff details.

##### **Example: Add Client with Staff Selection**

```json
POST /api/business/clients
{
  "phone": "+1234567890",
  "staffId": "64f8a1b2c3d4e5f678901234"
}
```

_Response:_

```json
{
  "message": "Client created successfully. Invitation SMS sent.",
  "client": {
    "_id": "...",
    "phone": "+1234567890",
    "staff": "64f8a1b2c3d4e5f678901234",
    ...
  },
  "invitationLink": "https://your-frontend.com/client/invitation/abc123..."
}
```

##### **Example: Fetch Client by Invitation Token (with Staff Info)**

```json
GET /api/client/invitation/:token
```

_Response:_

```json
{
  "success": true,
  "data": {
    "client": {
      "_id": "...",
      "phone": "+1234567890",
      "staff": {
        "_id": "64f8a1b2c3d4e5f678901234",
        "firstName": "Jane",
        "lastName": "Doe",
        "email": "jane@barbershop.com",
        "phone": "+1987654321"
      },
      ...
    },
    "business": { ... }
  }
}
```

#### **Key Features**

- **Partial Client Records:** Clients can exist with only a phone number until they complete their profile.
- **Invitation SMS:** Sent automatically on creation and can be resent by the business owner.
- **Profile Completion Enforcement:** Appointments cannot be booked for clients with incomplete profiles.
- **CSV Upload Support:** Bulk client upload supports phone-only creation and sends invitations for incomplete profiles.
- **Filtering:** List clients by profile completion status using the `isProfileComplete` filter.
- **Backward Compatibility:** Existing clients remain valid; only new clients use the two-step flow.

#### **New/Updated API Endpoints**

- `POST /api/business/clients` — **Create client with phone number only** (invitation SMS sent automatically)
- `POST /api/client/complete-profile` — **Client completes their profile** (public endpoint, uses invitation token)
- `POST /api/business/clients/:clientId/resend-invitation` — **Resend invitation SMS** for incomplete clients
- `GET /business/clients?isProfileComplete=true|false` — **Filter clients** by profile completion status
- `GET /client/invitation/:token` — **Get client details with business info** (enhanced with comprehensive business/barber details)
- `GET /client/business/:businessId` — **Get business details** (public endpoint for barber information)
- `POST /business/clients/upload-csv` — **Bulk upload clients** (supports phone-only, sends invitations for incomplete profiles)
- `POST /appointments/by-barber` — **Create appointment by barber** (now enforces profile completion)
- `GET /api/business/clients/phones-simple` — **Get all client phone numbers** (simple list without pagination)
- `POST /api/business/clients/messages` — **Send custom message to selected clients** (email + SMS)

##### **Field Changes**

- **Client Model:**
  - `firstName`, `lastName`, `email` are now optional for initial creation
  - New field: `isProfileComplete` (boolean)
- **Appointment Model:**
  - No change required, but booking logic now checks `isProfileComplete`

##### **Migration Note**

- Existing clients are unaffected. All new clients added via the API will use the new onboarding flow.

#### **Example Flow**

1. **Barber adds client:**
   ```json
   POST /api/business/clients
   { "phone": "+1234567890" }
   ```
   _Response:_
   ```json
   {
     "message": "Client created successfully. Invitation SMS sent.",
     "client": { ... },
     "invitationLink": "https://your-frontend.com/client/invitation/abc123..."
   }
   ```
2. **Client receives SMS and completes profile:**
   ```json
   POST /api/client/complete-profile
   {
     "invitationToken": "abc123...",
     "firstName": "John",
     "lastName": "Doe",
     "email": "john.doe@example.com"
   }
   ```
   _Response:_
   ```json
   {
     "message": "Profile completed successfully",
     "client": { ... }
   }
   ```
3. **Barber books appointment:**
   - Only possible if `isProfileComplete: true` for the client.

#### **CSV Upload**

- Only phone number is required for each client row.
- If first name, last name, and email are provided, the profile is marked complete.
- SMS invitations are sent for all incomplete profiles.

#### **Resend Invitation**

- Endpoint: `POST /api/business/clients/:clientId/resend-invitation`
- Only available for clients with incomplete profiles.

#### **Filtering & Search**

- Use `isProfileComplete=true|false` in `GET /business/clients` to filter clients.

#### **Appointment Booking Restriction**

- Attempting to book an appointment for an incomplete client returns an error.

#### **Public Client Access**

- `GET /client/invitation/:token` returns client details and `isProfileComplete` status.

#### **Enhanced Client Invitation System**

- **Business Details in Invitation Links**: Invitation links now include business ID for enhanced frontend display
- **Comprehensive Business Information**: Get complete barber/business details including contact info, address, hours, services, and profile images
- **Barber Profile Display**: Access owner information including name, email, phone, and profile image
- **Business Hours & Services**: Display operating hours and available services
- **Social Media Integration**: Show business social media links
- **Profile Images**: Display business logo, cover photo, and workspace images
- **Enhanced Frontend Experience**: Rich business information display for professional client onboarding

**New Invitation Link Format:**

```
http://localhost:3000/client/invitation/abc123...?business=64f8a1b2c3d4e5f678901234
```

**Enhanced API Response:**

```json
{
  "success": true,
  "data": {
    "client": {
      /* client details */
    },
    "business": {
      "name": "Professional Barbershop",
      "owner": {
        "name": "John Barber",
        "email": "john@barbershop.com",
        "phone": "+1234567890",
        "profileImage": "https://cloudinary.com/profile.jpg"
      },
      "contactInfo": {
        /* contact details */
      },
      "address": {
        /* address details */
      },
      "businessHours": {
        /* operating hours */
      },
      "services": [
        /* available services */
      ],
      "profileImages": {
        /* business images */
      },
      "socialMedia": {
        /* social media links */
      }
    }
  }
}
```

#### **Client Phone Management & Custom Messaging**

Business owners can now efficiently manage client phone numbers and send custom messages to selected clients.

##### **Phone Number Retrieval**

Retrieve all client phone numbers for quick reference:

```json
GET /api/business/clients/phones-simple
Authorization: Bearer <jwt_token>
```

**Response:**

```json
{
  "success": true,
  "data": {
    "phones": [
      { "clientId": "client1", "phone": "+1234567890" },
      { "clientId": "client2", "phone": "+1987654321" }
    ]
  }
}
```

##### **Bulk Custom Messaging**

Send custom messages to multiple selected clients via both email and SMS:

```json
POST /api/business/clients/messages
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "clientIds": ["clientId1", "clientId2", "clientId3"],
  "message": "Your custom message here. This will be sent via both email and SMS."
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "summary": {
      "totalTargets": 3,
      "emailSent": 2,
      "smsSent": 3
    },
    "results": [
      {
        "clientId": "clientId1",
        "email": "client1@example.com",
        "phone": "+1234567890",
        "emailSent": true,
        "emailError": null,
        "smsSent": true,
        "smsError": null
      },
      {
        "clientId": "clientId2",
        "email": "client2@example.com",
        "phone": "+1987654321",
        "emailSent": false,
        "emailError": "Failed to send email",
        "smsSent": true,
        "smsError": null
      },
      {
        "clientId": "clientId3",
        "email": null,
        "phone": "+1555555555",
        "emailSent": false,
        "emailError": null,
        "smsSent": true,
        "smsError": null
      }
    ]
  }
}
```

**Key Features:**

- **Dual Channel Delivery**: Messages are sent via both email and SMS automatically
- **Individual Tracking**: Each client's delivery status is tracked separately
- **Graceful Failure**: If email fails for one client, SMS still attempts delivery and vice versa
- **Active Client Filtering**: Only active clients receive messages
- **Business Scoping**: Messages can only be sent to clients belonging to the authenticated business owner
- **Comprehensive Summary**: Quick overview of total deliveries and success rates

---

### **Email Marketing System**

- **Campaign Creation**: Create email campaigns with rich HTML content and image uploads
- **Three Delivery Types**:
  - **Send Now**: Immediate email delivery
  - **Send Later**: Scheduled delivery at specific date/time
  - **Recurring**: Automatic sending based on recurring intervals
- **Automated Processing**: Cron job system processes scheduled campaigns every 5 minutes
- **Campaign Management**: Create, update, delete, and track email campaigns
- **Status Tracking**: Monitor campaign status (draft, scheduled, sent, failed, cancelled)
- **Manual Trigger**: API endpoints for manual processing and scheduler status monitoring

### **SMS Marketing System**

- **SMS Campaigns**: Create and manage SMS campaigns with similar delivery options
- **Twilio Integration**: Send SMS messages via Twilio API
- **Campaign Scheduling**: Schedule and recurring SMS campaigns
- **Delivery Tracking**: Monitor SMS delivery status and analytics

### **Message Blast System**

- **Email Blasts**: Send bulk emails to client groups (all, active, new)
- **Recipient Groups**: Target specific client segments
- **Delivery Options**: Immediate, scheduled, or recurring delivery
- **Personalization**: Dynamic content with client name replacement

### **Promotions & Flash Sales**

- **Happy Hours Promotions**: Create time-based promotions with discount percentages
- **Day-of-Week Scheduling**: Set promotions for specific days and time slots
- **Service-Specific Discounts**: Apply promotions to specific services
- **Flash Sales**: Create time-limited sales with start/end dates
- **Multiple Concurrent Discounts**: Activate multiple discounts simultaneously with confirmation prompts
- **Confirmation Mechanism**: Warning system alerts barbers when activating overlapping discounts
- **Smart Discount Application**: Flash sales take precedence over promotions when both apply to appointments
- **Status Management**: Activate/deactivate promotions and track performance

### **Advanced Analytics & Reporting**

- **Appointment Statistics**: Get detailed appointment counts and percentages by status
- **Revenue Projection**: Yearly, monthly, weekly, and daily revenue analytics with filtering
- **Business Performance Metrics**: Completion rates, cancellation analysis, and trends
- **Admin Dashboard**: Global statistics for platform administrators
- **Monthly Trends**: Appointment trends by month and year
- **Top Performers**: Rank barbers by completed appointments

### **Haircut Gallery System**

- Upload and manage haircut images for clients
- Gallery organization with titles, descriptions, and styling information
- Image reporting and moderation system
- Client-specific photo galleries
- AWS S3 integration for secure image storage
- **Suggestions can now include a single image upload**
- **Reports can now include a single image upload and a rating (1-5)**

### **Feature Suggestions**

- Staff can submit feature suggestions for platform improvements
- Admin review and management of suggestions
- Suggestion tracking and status management

### **Support System**

- **Support Tickets**: Create and manage support tickets
- **Priority Levels**: Low, Medium, High, Critical priority classification
- **Status Tracking**: Pending, resolved, completed status management
- **Admin Resolution**: Admin can resolve and update ticket status
- **Ticket Analytics**: Support statistics and performance metrics

### **Notification System**

- **Push Notifications**: Firebase Cloud Messaging integration
- **Email Notifications**: SendGrid integration for email alerts
- **Real-time Notifications**: Socket-based real-time updates
- **Notification Preferences**: User-configurable notification settings
- **Read Status Tracking**: Track notification read/unread status

### **Admin Management System**

- **User Management**: Admin controls for all platform users
- **Email Broadcasting**: Send emails to user groups (all, barbers, clients)
- **User Statistics**: Platform-wide user analytics
- **Recipient Groups**: Manage email recipient categories

### **Backup & Recovery System**

- **Database Backups**: Create manual and automated database backups
- **Cloudinary Storage**: Secure backup storage in the cloud
- **Backup Management**: List, download, and restore from backups
- **File Upload Restore**: Upload and restore from backup files
- **Backup Analytics**: Track backup status and performance

### **Notes System**

- **Client Notes**: Add and manage notes for individual clients
- **Business Notes**: Business-specific note management
- **Note Attribution**: Track who created each note

### **API Documentation**

- Comprehensive Swagger UI available at `/api-docs` for interactive API exploration
- Detailed request/response schemas and examples
- Auto-generated documentation from code comments

---

## Getting Started

### Prerequisites

- Node.js v14+
- MongoDB instance (local or cloud)
- AWS S3 (for image storage)
- Cloudinary (for image processing and backup storage)
- Firebase (for push notifications)
- SendGrid (for email notifications)
- Twilio (for SMS functionality)
- Stripe (for subscription management)
- Google Cloud Project with Translation API enabled (for multi-language support)

### Installation

1. **Clone the repository:**

   ```bash
   git clone https://github.com/ah2k-dev/userAuth-with-email-verification.git
   cd you-calendy-be
   ```

2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Configure environment variables:**

   - Copy `src/config/config.env.example` to `src/config/config.env` and fill in your values:

     ```env
     # Database
     MONGO_URI=your_mongodb_uri
     JWT_SECRET=your_jwt_secret

     # Email Services
     SENDGRID_API_KEY=your_sendgrid_key
     SENDGRID_FROM_EMAIL=your_verified_sender_email

     # AWS S3
     AWS_ACCESS_KEY_ID=your_aws_access_key
     AWS_SECRET_ACCESS_KEY=your_aws_secret_key
     AWS_REGION=your_aws_region
     AWS_S3_BUCKET=your_s3_bucket_name

     # Cloudinary
     CLOUDINARY_CLOUD_NAME=your_cloudinary_cloud_name
     CLOUDINARY_API_KEY=your_cloudinary_api_key
     CLOUDINARY_API_SECRET=your_cloudinary_api_secret

     # Twilio (SMS)
     TWILIO_ACCOUNT_SID=your_twilio_account_sid
     TWILIO_AUTH_TOKEN=your_twilio_auth_token
     TWILIO_FROM_NUMBER=your_twilio_phone_number

     # Stripe (Subscriptions)
     STRIPE_SECRET=your_stripe_secret_key
     STRIPE_PRICE_ID=your_stripe_price_id
     STRIPE_WEBHOOK_SECRET=your_stripe_webhook_secret

     # Firebase (Push Notifications)
     # Add your Firebase service account key to src/utils/fcm.json

     # Google Cloud Translation
     GCLOUD_PROJECT_ID=your-google-cloud-project-id
     GCLOUD_TRANSLATE_KEYFILE=path/to/gcloud-translate-key.json

     # Application
     FRONTEND_URL=http://localhost:3000
     PORT=5000
     NODE_ENV=development
     ```

4. **Run the server:**

   ```bash
   npm run dev
   # or
   npm start
   ```

5. **Access API docs:**
   - Visit [http://localhost:5000/api-docs](http://localhost:5000/api-docs) after starting the server.

---

## Project Structure

```
you-calendy-be/
├── src/
│   ├── app.js              # Express app setup and middleware
│   ├── index.js            # Entry point, environment, server start with scheduler
│   ├── config/             # DB and environment config
│   ├── controllers/        # Business logic for all features
│   │   ├── adminController.js           # Admin management & email broadcasting
│   │   ├── appointmentController.js     # Appointment management & analytics
│   │   ├── authController.js            # Authentication & user management
│   │   ├── backupController.js          # Database backup & recovery
│   │   ├── businessController.js        # Business settings, management & subscriptions
│   │   ├── clientController.js          # Client management & invitations
│   │   ├── featureSuggestionController.js # Feature suggestions
│   │   ├── flashSaleController.js       # Flash sales management
│   │   ├── haircutGalleryController.js  # Haircut gallery management
│   │   ├── messageBlastController.js    # Email blast campaigns
│   │   ├── notificationController.js    # Notification management
│   │   ├── promotionController.js       # Happy hours promotions
│   │   ├── serviceController.js         # Service management
│   │   ├── staffController.js           # Staff management
│   │   ├── statsController.js           # Analytics & reporting
│   │   ├── supportController.js         # Support ticket system
│   │   ├── planController.js            # Plan management & Stripe integration
│   │   ├── translateController.js       # Translation API controller
│   ├── models/             # Mongoose schemas
│   │   ├── appointment.js              # Appointment model
│   │   ├── backup.js                   # Backup model
│   │   ├── barberLink.js               # Barber link model
│   │   ├── client.js                   # Client model with invitation tokens
│   │   ├── emailCampaign.js            # Email campaign model
│   │   ├── featureSuggestion.js       # Feature suggestions model
│   │   ├── flashSale.js               # Flash sales model
│   │   ├── haircutGallery.js          # Haircut gallery model
│   │   ├── note.js                    # Notes model
│   │   ├── promotion.js               # Promotions model
│   │   ├── service.js                 # Service model
│   │   ├── smsCampaign.js             # SMS campaign model
│   │   ├── staff.js                   # Staff model
│   │   ├── support.js                 # Support tickets model
│   │   ├── plan.js                    # Plan model (Stripe price/product)
│   │   ├── translationCache.js        # Translation cache model
│   │   └── User/                      # User-related models
│   │       ├── business.js            # Business model with gallery images
│   │       ├── notification.js        # Notification model
│   │       └── user.js                # User model
│   ├── router/             # API route definitions
│   │   ├── admin.js                   # Admin routes
│   │   ├── appointments.js            # Appointment routes
│   │   ├── auth.js                    # Authentication routes
│   │   ├── barber.js                  # Public barber profile routes
│   │   ├── business.js                # Business, client & email campaign routes
│   │   ├── client.js                  # Public client routes
│   │   ├── featureSuggestions.js      # Feature suggestion routes
│   │   ├── flashSales.js              # Flash sales routes
│   │   ├── notifications.js           # Notification routes
│   │   ├── promotions.js              # Promotion routes
│   │   ├── services.js                # Service routes
│   │   ├── plans.js                   # Plan routes
│   │   ├── support.js                 # Support routes
│   │   └── translate.js               # Translation routes
│   ├── middleware/         # Auth, logging, access control
│   │   ├── auth.js                    # Authentication middleware
│   │   ├── loggerMiddleware.js        # Request logging
│   │   ├── restrictAccess.js          # Subscription access control
│   │   └── creditMiddleware.js         # Credit validation middleware
│   ├── utils/              # Helpers: mail, notifications, error handling, schedulers
│   │   ├── adminNotification.js       # Admin notification utilities
│   │   ├── ApiError.js                # API error handling
│   │   ├── aws.js                     # AWS S3 integration
│   │   ├── backupUtils.js             # Backup processing utilities
│   │   ├── creditManager.js           # Credit management utilities
│   │   ├── creditAwareMessaging.js    # Credit-aware messaging functions
│   │   ├── emailScheduler.js          # Email campaign processing logic
│   │   ├── emailTemplates.js          # Email template management
│   │   ├── ErrorHandler.js            # Error response handling
│   │   ├── index.js                   # Utility exports
│   │   ├── migrateClientTokens.js     # Client token migration script
│   │   ├── pushNotification.js        # Firebase push notifications
│   │   ├── scheduler.js               # Cron job management
│   │   ├── sendMail.js                # Email sending utilities
│   │   ├── SuccessHandler.js          # Success response handling
│   │   ├── twilio.js                  # SMS sending via Twilio
│   │   └── translator.js              # Google Cloud Translation utilities
│   └── functions/          # Cloudinary, AWS, webhooks, sockets
│       ├── cloudinary.js              # Cloudinary image processing
│       ├── logger.js                  # Logging utilities
│       ├── socketFunctions.js         # Socket.io real-time features
│       └── webhook.js                 # Webhook processing
├── logs/                   # Application logs
├── swagger.js              # Swagger API doc generator
├── swagger_output.json     # Generated Swagger spec
├── EMAIL_MARKETING.md      # Email marketing feature documentation
├── CRON_SETUP.md           # Cron job setup guide
├── CLIENT_INVITATION_FEATURE.md # Client invitation feature documentation
├── CREDIT_MANAGEMENT_SYSTEM.md # Credit management system documentation
├── test_credit_system.js    # Credit system test script
├── package.json            # Dependencies and scripts
└── railway.json            # Railway deployment configuration
```

---

## API Overview

### **Main Endpoints**

#### **Authentication**

- `POST /auth/register` - User registration
- `POST /auth/login` - User login
- `POST /auth/forgotPassword` - Password reset request
- `POST /auth/resetPassword` - Password reset
- `GET /auth/me` - Get current user profile
- `PUT /auth/updateProfile` - Update user profile
- `GET /auth/profile-settings` - Get user profile settings

#### **Business Management**

- `GET /business` - Get business information
- `PUT /business` - Update business information
- `GET /business/settings` - Get business settings (logo, photos, gallery)
- `PUT /business/settings` - Update business settings
- `GET /business/clients` - Get business clients
- `POST /business/clients` - Add new client
- `GET /business/services` - Get business services
- `POST /business/services` - Add new service (no duration required)
- `POST /business/start-trial` - Start free trial
- `GET /business/subscription-status` - Get subscription status
- `POST /business/create-subscription` - Create Stripe subscription
- `GET /business/staff/:staffId/working-hours` - Get staff working hours with dynamically generated time slots (supports `date` and optional `serviceId`, excludes past slots and respects booking buffer)
- `POST /business/staff/:staffId/replicate-schedule` - Replicate staff schedule across multiple days

#### **Email Marketing**

- `POST /business/email-campaigns` - Create email campaign (with image upload)
- `GET /business/email-campaigns` - Get all email campaigns
- `PUT /business/email-campaigns/:campaignId` - Update email campaign
- `DELETE /business/email-campaigns/:campaignId` - Delete email campaign
- `POST /business/email-campaigns/:campaignId/send` - Send campaign immediately
- `POST /business/email-campaigns/process` - Manually trigger campaign processing
- `GET /business/email-campaigns/scheduler-status` - Get scheduler status

#### **SMS Marketing**

- `POST /business/sms-campaigns` - Create SMS campaign
- `GET /business/sms-campaigns` - Get all SMS campaigns
- `PUT /business/sms-campaigns/:campaignId` - Update SMS campaign
- `DELETE /business/sms-campaigns/:campaignId` - Delete SMS campaign
- `POST /business/sms-campaigns/:campaignId/send` - Send SMS campaign immediately

#### **Message Blast**

- `POST /business/message-blast/email` - Send email blast to clients
- `GET /business/message-blast/recipient-groups` - Get recipient group statistics
- `GET /business/message-blast/stats` - Get message blast statistics

#### **Client Management & Invitations**

- `GET /business/clients/:clientId/invitation-link` - Get client invitation link
- `POST /business/clients/:clientId/invitation-link` - Generate new invitation link
- `GET /client/invitation/:token` - Get client details by invitation token (public)
- `GET /api/business/clients/phones-simple` - Get all client phone numbers for business owner
- `POST /api/business/clients/messages` - Send custom message (email + SMS) to selected clients

#### **Appointments**

- `GET /appointments` - Get appointments with filtering
- `POST /appointments` - Create new appointment
- `PUT /appointments/:id` - Update appointment
- `PUT /appointments/:id/status` - Update appointment status
- `GET /appointments/available` - Get available time slots (excludes past slots and respects booking buffer)
- `POST /appointments/by-barber` - Create appointment by barber
- `GET /appointments/stats` - Get appointment statistics
- `GET /appointments/revenue-projection` - Get revenue analytics
- `GET /appointments/history` - Get appointment history

#### **Promotions (Happy Hours)**

- `POST /promotions` - Create new promotion (supports `confirmMultiple` parameter for multiple concurrent discounts)
- `GET /promotions` - Get all promotions with filtering
- `GET /promotions/:id` - Get specific promotion
- `PUT /promotions/:id` - Update promotion (supports `confirmMultiple` parameter for multiple concurrent discounts)
- `DELETE /promotions/:id` - Delete promotion
- `PATCH /promotions/:id/toggle` - Toggle promotion status
- `GET /promotions/active` - Get active promotions
- `GET /promotions/stats` - Get promotion statistics

#### **Flash Sales**

- `POST /flash-sales` - Create new flash sale (supports `confirmMultiple` parameter for multiple concurrent discounts)
- `GET /flash-sales` - Get all flash sales with filtering
- `GET /flash-sales/:id` - Get specific flash sale
- `PUT /flash-sales/:id` - Update flash sale (supports `confirmMultiple` parameter for multiple concurrent discounts)
- `DELETE /flash-sales/:id` - Delete flash sale
- `PATCH /flash-sales/:id/toggle` - Toggle flash sale status
- `GET /flash-sales/active` - Get active flash sales
- `GET /flash-sales/stats` - Get flash sale statistics

#### **Haircut Gallery**

- `POST /business/clients/:clientId/gallery` - Upload haircut image
- `GET /business/clients/:clientId/gallery` - Get client gallery
- `POST /business/gallery/:galleryId/suggestions` - Add suggestion to gallery image (**now supports single image upload**)
- `POST /business/gallery/:galleryId/reports` - Report gallery image (**now supports single image upload and rating**)
- `GET /business/gallery/reports` - Get reported images
- `DELETE /business/gallery/:galleryId` - Delete gallery image

**New/Updated API Usage Examples:**

**Add Suggestion with Image:**

```
POST /api/business/gallery/:galleryId/suggestions
Content-Type: multipart/form-data
- note: "Great haircut style!"
- clientId: "client123"
- image: [file] (optional)
```

**Report with Image and Rating:**

```
POST /api/business/gallery/:galleryId/reports
Content-Type: multipart/form-data
- note: "Inappropriate content"
- clientId: "client123"
- rating: 2
- image: [file] (optional)
```

**Schema Changes:**

- Suggestions now include `imageUrl` and `imagePublicId` fields.
- Reports now include `imageUrl`, `imagePublicId`, and `rating` fields.

#### **Feature Suggestions**

- `GET /feature-suggestions` - Get all feature suggestions
- `POST /feature-suggestions` - Create feature suggestion
- `PUT /feature-suggestions/:id` - Update feature suggestion
- `DELETE /feature-suggestions/:id` - Delete feature suggestion

#### **Support System**

- `GET /support` - Get all support tickets (admin)
- `GET /support/my-tickets` - Get current user's support tickets
- `POST /support` - Create support ticket
- `GET /support/:id` - Get specific support ticket
- `PUT /support/:id` - Update support ticket
- `DELETE /support/:id` - Delete support ticket
- `PATCH /support/:id/priority` - Update ticket priority
- `PATCH /support/:id/status` - Update ticket status
- `GET /support/stats` - Get support statistics

#### **Admin Management**

- `POST /admin/send-email` - Send email to user groups
- `GET /admin/user-stats` - Get user statistics
- `GET /admin/recipient-groups` - Get recipient group statistics
- `GET /admin/stats/appointments-trend` - Get appointment trends
- `GET /admin/stats/top-barbers` - Get top performing barbers
- `GET /admin/stats/revenue-projection` - Get global revenue analytics

#### **Backup & Recovery**

- `POST /admin/backup` - Create manual backup
- `GET /admin/backup` - Get all backups
- `GET /admin/backup/:id` - Get specific backup
- `DELETE /admin/backup/:id` - Delete backup
- `POST /admin/backup/:id/restore` - Restore from backup
- `POST /admin/backup/upload-restore` - Upload and restore from file

#### **Notifications**

- `GET /notifications` - Get user notifications
- `PATCH /notifications/mark-all-read` - Mark all notifications as read

#### **Plans**

- `GET /plans` — List all active plans (public)
- `GET /plans/:id` — Get plan details (public)
- `POST /plans` — Create a new plan (admin only, Stripe integration)
- `PUT /plans/:id` — Update a plan (admin only, Stripe integration)
- `DELETE /plans/:id` — Delete a plan (admin only, Stripe integration)
- `GET /plans/admin/all` — List all plans (admin only)

#### **Translation**

- `POST /api/translate` — Translate text using Google Cloud Translation API

#### **Credit Management**

- `GET /api/business/credits` — Get current credit balance
- `POST /api/business/check-campaign-credits` — Check credits for campaigns
- `POST /api/credits/checkout-session` — Create checkout session for credit purchase

#### **Barber Link System**

- `GET /api/barber/profile/:linkToken` — Get comprehensive barber profile by link token (public)
- `GET /api/business/barber-link` — Get current barber link for business
- `POST /api/business/barber-link/regenerate` — Regenerate barber link

See [Swagger UI](http://localhost:5000/api-docs) for full details and request/response schemas.

---

## Key Features in Detail

### **Email Marketing System**

The email marketing system provides comprehensive campaign management with three delivery types:

#### **Campaign Creation**

- **Content Management**: Rich HTML content support for professional emails
- **Image Upload**: Upload campaign images that are included in emails
- **Target Email**: Specify individual email addresses for campaigns

#### **Delivery Types**

1. **Send Now**

   - Immediate email delivery
   - Campaign status changes to "sent" immediately
   - No scheduling required

2. **Send Later**

   - Scheduled delivery at a specific date/time
   - Campaign status: "scheduled" → "sent"
   - Requires `scheduledDate` parameter
   - Processed by automated cron job

3. **Recurring**
   - Automatic sending based on recurring intervals
   - Campaign status: "scheduled" → "sent" → "scheduled" (for next send)
   - Requires `recurringInterval` parameter (days)
   - Calculates next send date automatically
   - Processed by automated cron job

#### **Automated Processing**

- **Cron Job System**: Runs every 5 minutes to process scheduled campaigns
- **Automatic Startup**: Scheduler initializes when server starts
- **Error Handling**: Individual campaign failures don't affect others
- **Status Monitoring**: API endpoints for checking scheduler status
- **Manual Trigger**: API endpoint for manual campaign processing

#### **Campaign Management**

- **Status Tracking**: Monitor campaign status (draft, scheduled, sent, failed, cancelled)
- **CRUD Operations**: Create, read, update, delete campaigns
- **Image Management**: Automatic cleanup of old images when updating
- **Error Logging**: Failed campaigns are marked with error messages

### **SMS Marketing System**

Similar to email marketing but for SMS campaigns:

- **Twilio Integration**: Send SMS via Twilio API
- **Campaign Scheduling**: Schedule and recurring SMS campaigns
- **Delivery Tracking**: Monitor SMS delivery status
- **Error Handling**: Track failed SMS deliveries

### **Message Blast System**

Bulk email system for client communication:

- **Recipient Groups**: Target all, active, or new clients
- **Personalization**: Dynamic content with client name replacement
- **Delivery Options**: Immediate, scheduled, or recurring delivery
- **Statistics**: Track success rates and failed deliveries

### **Promotions & Flash Sales**

#### **Happy Hours Promotions**

- **Time-Based Discounts**: Set specific days and time slots for promotions
- **Service Targeting**: Apply discounts to specific services
- **Multiple Concurrent Promotions**: Activate multiple promotions simultaneously with confirmation
- **Confirmation Warnings**: System alerts when activating overlapping promotions
- **Status Management**: Activate/deactivate promotions

#### **Flash Sales**

- **Time-Limited Offers**: Create sales with start/end dates
- **Multiple Concurrent Flash Sales**: Activate multiple flash sales simultaneously with confirmation
- **Confirmation Warnings**: System alerts when activating overlapping flash sales
- **Performance Tracking**: Monitor flash sale effectiveness

#### **Multiple Discounts System**

- **Concurrent Activation**: Barbers can activate multiple discounts (both promotions and flash sales) at the same time
- **Confirmation Mechanism**: When activating a new discount while another is active, the API returns HTTP 409 with a warning message
- **User Confirmation**: Frontend can show confirmation dialog, then resubmit with `confirmMultiple: true` parameter
- **Smart Application**: When multiple discounts apply to an appointment, flash sales take precedence over promotions
- **Backward Compatible**: All existing discount logic remains unchanged, only overlap prevention removed
- **API Response Format**: Returns detailed information about existing discounts in the error response for frontend display

### **Client Invitation Links**

- Generate unique, secure invitation tokens for each client
- Share invitation links that allow clients to view their details
- Public access to client information via invitation tokens
- Token regeneration capability for security

### **Business Settings Management**

- Upload and manage business logo
- Manage workplace photos (up to 10 images)
- Gallery images management (up to 20 images)
- Automatic old file cleanup when updating images
- AWS S3 integration for secure file storage

### **Enhanced Business Profile Management**

- **Personal Information**: Store and manage `personalName` and `surname` fields
- **Complete Profile Updates**: Comprehensive business profile updates via `PUT /api/business`
- **Flexible Updates**: Support for partial updates of business information
- **Backward Compatibility**: Existing businesses remain unaffected by new fields
- **Profile Validation**: Proper validation and error handling for profile updates

### **Advanced Appointment Analytics**

- **Appointment Statistics**: Total counts and percentages by status
- **Revenue Projection**: Yearly aggregation with filtering by date ranges
- **Completion Rates**: Track appointment completion and cancellation rates
- **Business Performance**: Comprehensive business insights

### **Haircut Gallery System**

- Client-specific photo galleries
- Image metadata (title, description, haircut style)
- Reporting system for inappropriate content
- Staff attribution and appointment linking

### **Support System**

- **Ticket Management**: Create, update, and track support tickets
- **Priority Levels**: Low, Medium, High, Critical classification
- **Status Tracking**: Pending, resolved, completed status
- **Admin Resolution**: Admin can resolve and update tickets
- **Analytics**: Support performance metrics

### **Real-time Notifications**

- Push notifications via Firebase
- Email notifications via SendGrid
- Socket-based real-time updates
- Notification preferences and read status

### **Admin Management**

- **User Broadcasting**: Send emails to user groups
- **Platform Analytics**: Global user and business statistics
- **System Monitoring**: Track platform performance
- **User Management**: Admin controls for all users

### **Backup & Recovery**

- **Automated Backups**: Scheduled database backups
- **Cloud Storage**: Secure backup storage in Cloudinary
- **Restore Capabilities**: Full database restoration
- **File Upload**: Upload and restore from backup files

### **Translation System**

- **Google Cloud Integration**: Complete translation system using Google Cloud Translation API
- **MongoDB Caching**: Efficient translation caching to minimize API calls and costs
- **Multi-language Support**: Support for 100+ languages with automatic language detection
- **Frontend Integration**: Language selector with cookie persistence for seamless UX
- **Error Handling**: Robust error handling with fallback to original text
- **Security**: Secure credential management with service account restrictions
- **Performance**: Optimized caching mechanism for improved response times

### **Credit Management System**

- **SMS & Email Credits**: Comprehensive credit system for all messaging operations
- **Credit Validation**: Automatic credit checking before sending messages
- **Credit Deduction**: Real-time credit deduction for all messaging operations
- **Credit Purchase**: Stripe-integrated credit purchase system with webhook processing
- **Campaign Protection**: Credit validation for bulk SMS and Email campaigns
- **Appointment Notifications**: Credit-aware SMS for appointment reminders and review requests
- **Client Invitations**: Credit validation for client invitation SMS
- **Middleware Support**: Express middleware for consistent credit validation
- **Non-Disruptive Implementation**: Only SMS/Email features affected by credit validation
- **Graceful Error Handling**: Proper HTTP 402 responses with consistent error structures
- **Audit Trail**: Complete credit usage tracking and logging
- **Graceful Degradation**: Critical operations don't fail due to credit issues
- **Security**: Server-side credit validation with business isolation

### **Barber Link System**

- **Automatic Link Generation**: Unique barber profile links created during registration
- **Comprehensive Profile Data**: Includes business details, services, staff, appointment stats, and more
- **Public Access**: Anyone with the link can view barber profile (no authentication required)
- **Access Tracking**: Monitors link usage with access count and timestamps
- **Link Management**: Barbers can view and regenerate their profile links
- **Security**: Unique tokens prevent unauthorized access
- **Rich Data Display**: Complete business information including contact details, hours, services, and images
- **Professional Presence**: Showcases barber's business for client engagement
- **Analytics**: Track profile views and engagement metrics
- **Easy Sharing**: Simple way for barbers to share their professional profile
- **Client Experience**: High-quality business presentation for potential clients
- **Marketing Tool**: Use as marketing and promotional material
- **Platform Value**: Adds significant value to the platform with unique features

### **Service-Specific Time Interval & Working Hours API**

- **Service-Specific Time Intervals**: New service-specific `timeInterval` field in staff services array defines the gap (in minutes) between appointment start times for each specific service (configurable 5–120).
- **Default Time Interval**: Staff model includes a default `timeInterval` field used as fallback when no service-specific interval is available.
- **Shift-Based Slot Generation**: Time slots are generated dynamically from each shift's `start` → `end` using the service-specific `timeInterval` when a service is selected, or default staff interval when no service is specified.
- **Service-Aware Filtering**: When a `serviceId` is provided, only slots that can fully accommodate the service duration within the shift are returned.
- **Booked Slot Exclusion**: Slots overlapping existing non-canceled appointments are excluded.
- **Endpoint**: `GET /api/business/staff/:staffId/working-hours?date=YYYY-MM-DD[&serviceId=...]`
  - Without `serviceId`: returns ALL possible slots at the staff's default interval (e.g., every 15 minutes).
  - With `serviceId`: returns only slots where the service-specific time interval fits within the shift and not already booked.

### **Booking Buffer & Past Time Validation System**

The booking buffer and past time validation system prevents unreliable clients from booking inappropriate appointments and ensures a smooth booking experience.

#### **Booking Buffer Configuration**

- **Staff-Specific Settings**: Each staff member can configure their own `bookingBuffer` (0-1440 minutes)
- **Business Defaults**: Business-wide default booking buffer settings for consistency
- **Flexible Configuration**: Buffer can be set from 0 minutes (immediate booking) to 24 hours (1440 minutes)
- **Real-time Application**: Buffer only applies to today's appointments, future dates are unaffected

#### **Past Time Prevention**

- **Automatic Filtering**: All past time slots are automatically filtered out from available slots
- **Real-time Updates**: Time slot availability updates based on current time
- **Cross-Date Validation**: Works for all dates (today, tomorrow, future dates)
- **Appointment Creation Validation**: Prevents booking appointments in the past during creation

#### **Smart Time Slot Filtering**

- **Combined Logic**: Available slots exclude both past times and slots within booking buffer
- **Real-time Calculation**: Filtering happens in real-time based on current time
- **Service Compatibility**: Filtering works with service-specific slot generation
- **Staff-Specific**: Each staff member's buffer settings are respected independently

#### **API Integration**

All appointment-related endpoints now include booking buffer and past time validation:

- **`POST /api/appointments`**: Validates past time and booking buffer during appointment creation
- **`POST /api/appointments/barber`**: Same validation for barber-created appointments
- **`GET /api/appointments/available`**: Filters available slots based on current time and booking buffer
- **`GET /api/business/staff/:staffId/working-hours`**: Returns only valid future slots respecting booking buffer

#### **Error Handling**

The system provides clear, user-friendly error messages:

- **Past Time Error**: "Cannot book appointments in the past. Please select a future time slot."
- **Booking Buffer Error**: "This appointment must be booked at least X minutes in advance. Current time difference: Y minutes."

#### **Example Scenarios**

1. **Booking Buffer Example**:

   - Barber sets 30-minute buffer
   - Current time: 3:05 PM
   - Result: 3:30 PM and earlier slots are unavailable

2. **Past Time Example**:

   - Current time: 10:42 AM
   - User tries to book 9:00 AM appointment
   - Result: Error message prevents booking

3. **Combined Example**:
   - Current time: 2:50 PM
   - Barber has 15-minute buffer
   - Result: Only slots from 3:05 PM onwards are available

#### **Database Schema Updates**

- **Staff Model**: Added `bookingBuffer` field (Number, default: 0, min: 0, max: 1440)
- **Business Model**: Added `bookingBuffer` field for business-wide defaults
- **Validation**: Proper validation ensures buffer values are within acceptable range

#### **Benefits**

- **Prevents Last-Minute Bookings**: Reduces no-shows and late arrivals
- **Improves Scheduling**: Ensures adequate preparation time for appointments
- **Enhances User Experience**: Clear error messages guide users to valid time slots
- **Flexible Configuration**: Each staff member can set their own preferences
- **Real-time Updates**: Time slot availability updates automatically
- **Prevents Impossible Appointments**: No more booking appointments in the past

---

## Non-Disruptive Credit Validation Implementation

### Overview

The credit validation system has been designed to ensure that **only SMS and Email sending features are affected** when credits are insufficient or exhausted. All other business functionality continues to work normally without any disruption.

### Key Design Principles

#### **1. Isolated Credit Validation**

- Credit validation only occurs during SMS/Email sending operations
- Other business functions (appointments, clients, services, etc.) are completely unaffected
- Credit checking is performed independently and doesn't block other operations

#### **2. Graceful Error Handling**

- When credits are insufficient, SMS/Email operations fail gracefully
- Error messages are logged but don't crash the application
- Main business operations continue even if messaging fails

#### **3. Consistent Error Structure**

- All credit-aware functions return consistent error objects
- Controllers can reliably detect and handle credit validation failures
- Error responses use HTTP 402 (Payment Required) status code

### Implementation Details

#### **Credit-Aware Messaging Functions**

The following functions handle credit validation and return consistent error structures:

```javascript
// Single SMS with credit validation
const smsResult = await sendSMSWithCredits(
  phone,
  message,
  businessId,
  req,
  res
);

// Single Email with credit validation
const emailResult = await sendEmailWithCredits(
  email,
  subject,
  content,
  businessId,
  req,
  res
);

// Bulk SMS with credit validation
const bulkSmsResult = await sendBulkSMSWithCredits(
  recipients,
  message,
  businessId,
  req,
  res
);

// Bulk Email with credit validation
const bulkEmailResult = await sendBulkEmailWithCredits(
  recipients,
  subject,
  content,
  businessId,
  req,
  res
);
```

#### **Error Structure**

When credits are insufficient, these functions return:

```javascript
{
  error: true,
  message: "Insufficient SMS credits" | "Insufficient Email credits",
  creditsRequired: number
}
```

When credits are sufficient, they return:

```javascript
{
  success: true,
  messageId?: string, // For SMS
  creditsUsed: number
}
```

#### **Controller Integration Pattern**

Controllers use this pattern to handle credit validation failures:

```javascript
// Example: Adding a client with SMS invitation
const addClient = async (req, res) => {
  try {
    // Main business logic - always executes
    const client = await Client.create(clientData);
    console.log("✅ Client created successfully");

    // SMS sending with credit validation
    const smsResult = await sendSMSWithCredits(
      phone,
      invitationMessage,
      business._id,
      req,
      res
    );

    // Handle credit validation failure gracefully
    if (smsResult && smsResult.error) {
      console.error(
        "⚠️ SMS failed due to insufficient credits:",
        smsResult.message
      );
      // Don't fail the request, just log the error
    } else {
      console.log("✅ SMS invitation sent successfully");
    }

    // Continue with other operations
    return SuccessHandler({ client }, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};
```

### Affected vs Non-Affected Features

#### ✅ **Features Affected by Credit Validation**

1. **SMS Sending Operations:**

   - Client invitation SMS
   - Appointment reminder SMS
   - Review request SMS
   - SMS campaigns
   - Bulk SMS operations

2. **Email Sending Operations:**
   - Email campaigns
   - Email blasts
   - Bulk email operations
   - Scheduled email campaigns

#### ✅ **Features NOT Affected by Credit Validation**

1. **Core Business Operations:**

   - Creating/updating appointments
   - Adding/updating clients
   - Managing services
   - Business profile management
   - Settings management

2. **Data Operations:**

   - Reading data (appointments, clients, services)
   - Updating business information
   - Managing business hours
   - Location management

3. **Authentication & Authorization:**

   - User login/logout
   - Password reset (system emails)
   - Token validation
   - Access control

4. **System Functions:**
   - File uploads
   - Image processing
   - Database operations
   - API responses
   - Error handling

### Error Handling Examples

#### **1. Appointment Controller**

```javascript
// Review request SMS - doesn't break appointment update
if (clientPhone) {
  try {
    const smsResult = await sendSMSWithCredits(
      clientPhone,
      reviewMessage,
      business._id,
      req,
      res
    );

    if (smsResult && smsResult.error) {
      console.error(
        "Insufficient SMS credits for review request:",
        smsResult.message
      );
      // Don't fail the appointment update, just log the error
    } else {
      // Update appointment with review request information
      appointment.reviewRequest = {
        sent: true,
        message: reviewMessage,
        sentAt: new Date(),
        creditsUsed: smsResult.creditsUsed,
      };
    }
  } catch (smsError) {
    console.error("Failed to send review request SMS:", smsError.message);
    // Don't fail the appointment update
  }
}
```

#### **2. Client Controller**

```javascript
// Client invitation SMS - doesn't break client creation
try {
  const smsResult = await sendSMSWithCredits(
    phone,
    smsMessage,
    business._id,
    req,
    res
  );

  if (smsResult && smsResult.error) {
    console.error(
      "Insufficient SMS credits for invitation:",
      smsResult.message
    );
    // Don't fail the request if credits insufficient, just log the error
  }
} catch (smsError) {
  console.error("Failed to send invitation SMS:", smsError.message);
  // Don't fail the request if SMS fails
}
```

#### **3. Business Controller**

```javascript
// Email campaign - returns proper error response
const results = await sendBulkEmailWithCredits(
  recipients,
  subject,
  content,
  business._id,
  req,
  res
);

if (results && results.error) {
  return ErrorHandler(
    results.message,
    402, // Payment Required
    req,
    res
  );
}
```

### Benefits of This Approach

1. **Non-Disruptive**: Core business operations continue even without credits
2. **User-Friendly**: Users can still manage their business without being blocked
3. **Graceful Degradation**: SMS/Email features fail gracefully with clear error messages
4. **Maintainable**: Clear separation between credit validation and business logic
5. **Scalable**: Easy to add credit validation to new messaging features

### Best Practices

1. **Always wrap SMS/Email operations in try-catch blocks**
2. **Check for `result.error` before proceeding with success logic**
3. **Log credit validation failures but don't fail the main operation**
4. **Use HTTP 402 status code for credit-related errors**
5. **Provide clear error messages to users about credit requirements**

---

## Dependencies

### **Core Dependencies**

- **express**: Web framework
- **mongoose**: MongoDB ODM
- **jsonwebtoken**: JWT authentication
- **bcryptjs**: Password hashing
- **cors**: Cross-origin resource sharing
- **dotenv**: Environment variable management
- **multer**: File upload handling
- **express-fileupload**: Alternative file upload handling

### **Email & Notifications**

- **@sendgrid/mail**: SendGrid email service
- **nodemailer**: Email sending library
- **nodemailer-sendgrid-transport**: SendGrid transport for Nodemailer
- **nodemailer-brevo-transport**: Brevo transport for Nodemailer
- **firebase-admin**: Firebase Cloud Messaging for push notifications

### **SMS & Communication**

- **twilio**: Twilio SMS service
- **socket.io**: Real-time communication

### **File Management**

- **@aws-sdk/client-s3**: AWS S3 for file storage
- **cloudinary**: Cloud image processing and storage
- **streamifier**: Stream handling for file uploads

### **Translation & Internationalization**

- **@google-cloud/translate**: Google Cloud Translation API for multi-language support

### **Scheduling & Processing**

- **cron**: Cron job scheduling for email campaigns
- **moment**: Date/time manipulation

### **Payment Processing**

- **stripe**: Stripe payment processing

### **Validation & Utilities**

- **joi**: Data validation
- **validator**: Additional validation utilities
- **winston**: Logging
- **csv-parse**: CSV parsing for data import/export

### **Development Dependencies**

- **nodemon**: Development server with auto-restart
- **swagger-autogen**: Swagger documentation generation
- **swagger-ui-express**: Swagger UI for API documentation

---

## Developer Flow & Architecture

### 1. **Environment & Startup**

- Loads environment variables from `src/config/config.env` (or system env)
- Connects to MongoDB using Mongoose
- Starts the Express server (tries alternate ports if default is busy)
- **Initializes email campaign scheduler** with cron job processing
- Exposes API at `/` and documentation at `/api-docs`

### 2. **Express App & Middleware**

- CORS enabled for allowed origins
- JSON and URL-encoded body parsing
- Custom logger and error handler middleware
- Static file serving for uploads
- Multer configuration for file uploads

### 3. **Routing & Controllers**

- All routes are defined in `src/router/` and loaded via `src/app.js`
- Each route file maps endpoints to controller logic
- Protected routes use authentication middleware
- Controllers handle validation, DB operations, and business rules

### 4. **Models & Database**

- Mongoose schemas for all entities with proper indexing
- **EmailCampaign & SmsCampaign models** with delivery types and scheduling
- Client model includes invitation token functionality
- Business model supports gallery images and settings
- Appointment model with comprehensive status tracking
- Support, Promotion, FlashSale models for additional features
- **Plan model** with Stripe price/product sync

### 5. **File Management**

- AWS S3 integration for business images
- Cloudinary integration for haircut gallery images and backups
- Automatic file cleanup and optimization
- Secure file upload with size and type validation

### 6. **Email Marketing System**

- **EmailCampaignScheduler**: Manages cron jobs for campaign processing
- **Email Scheduler**: Processes scheduled and recurring campaigns
- **Automated Processing**: Runs every 5 minutes via cron job
- **Manual Triggering**: API endpoints for manual processing
- **Status Monitoring**: Real-time scheduler status checking

### 7. **SMS Marketing System**

- **Twilio Integration**: Send SMS messages via Twilio API
- **SmsCampaign Model**: Similar structure to email campaigns
- **Scheduling Support**: Scheduled and recurring SMS campaigns

### 8. **Notifications & Real-time Features**

- Push notifications via Firebase (see `src/utils/fcm.json`)
- Email sending via SendGrid (see `src/utils/sendMail.js`)
- SMS sending via Twilio (see `src/utils/twilio.js`)
- Socket-based real-time notifications
- Notification types include appointment events, business actions, and more

### 9. **Credit Management System**

- **Credit Manager**: Core utility functions for credit operations (`src/utils/creditManager.js`)
- **Credit-Aware Messaging**: Wrapper functions that validate credits before sending (`src/utils/creditAwareMessaging.js`)
- **Credit Middleware**: Express middleware for consistent credit validation (`src/middleware/creditMiddleware.js`)
- **Credit Purchase**: Stripe-integrated credit purchase system with webhook processing
- **Campaign Integration**: All SMS and Email campaigns validate and deduct credits
- **Appointment Integration**: Credit validation for appointment notifications and reminders
- **Client Integration**: Credit validation for client invitation SMS
- **Non-Disruptive Design**: Only SMS/Email features affected by credit validation
- **Graceful Error Handling**: Consistent error structures with proper HTTP responses
- **Audit Trail**: Complete credit usage tracking and logging

### 10. **API Documentation**

- Swagger docs are auto-generated via `swagger.js` and available at `/api-docs`
- Update docs by running:
  ```bash
  npm run swagger
  ```

---

## Email Marketing Setup

### **Environment Variables**

Add these to your environment configuration:

```env
# Email Marketing (SendGrid)
SENDGRID_API_KEY=your_sendgrid_api_key
SENDGRID_FROM_EMAIL=your_verified_sender_email

# SMS Marketing (Twilio)
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_FROM_NUMBER=your_twilio_phone_number

# AWS S3 (for campaign images)
AWS_ACCESS_KEY_ID=your_aws_access_key
AWS_SECRET_ACCESS_KEY=your_aws_secret_key
AWS_REGION=your_aws_region
AWS_S3_BUCKET=your_s3_bucket_name

# Cloudinary (for backup storage)
CLOUDINARY_CLOUD_NAME=your_cloudinary_cloud_name
CLOUDINARY_API_KEY=your_cloudinary_api_key
CLOUDINARY_API_SECRET=your_cloudinary_api_secret
```

### **Testing Email Marketing**

Use the provided test script:

```bash
# Update the token in test-email-marketing.js
node test-email-marketing.js
```

### **Cron Job Setup**

The email campaign scheduler is automatically initialized when the server starts. For production deployment:

1. **Cloud Platforms**: Use built-in cron job features
2. **VPS/Server**: The scheduler runs automatically with the application
3. **Manual Testing**: Use the `/api/business/email-campaigns/process` endpoint

See `CRON_SETUP.md` for detailed setup instructions.

---

## Contributing & Extending

- Follow the existing structure for new features (add models, controllers, routes as needed)
- Use environment variables for secrets and configuration
- Write clear, modular controller logic and document new endpoints in Swagger comments
- Ensure proper error handling and validation for all new features
- Maintain backward compatibility when possible
- For email marketing features, follow the established patterns in `src/utils/emailScheduler.js` and `src/utils/scheduler.js`

---

## License

ISC

---

## Author

[anasayub](https://github.com/anasayub80)

## Freemium-to-Premium Membership Model (Barber Platform)

### Overview

- Each barber (business) gets a **free 2-week trial** (only once) after completing business and service setup.
- After 2 weeks, the trial **automatically expires**. The barber must **subscribe to a paid premium plan** to continue using the platform.
- Stripe Subscriptions API is used for payment and subscription management.

### How it Works

1. **Trial Start**: After business and at least one service are set up, the barber can start their free trial via the `/api/business/start-trial` endpoint. This can only be done once per business.
2. **Trial Expiry**: The trial lasts 14 days. After that, the barber must subscribe to a premium plan to continue using premium features.
3. **Stripe Subscription**: The `/api/business/create-subscription` endpoint creates a Stripe subscription (with a 14-day trial if not already used). Stripe will automatically attempt to charge after the trial.
4. **Subscription Status**: The `/api/business/subscription-status` endpoint returns the current trial/subscription status and the appropriate frontend message.
5. **Access Restriction**: After the trial expires, access to premium features is restricted unless the subscription is active. This is enforced by the `restrictAccess` middleware.

### Stripe Integration

- Uses Stripe Subscriptions API.
- Each business is linked to a Stripe customer and subscription.
- Stripe webhook events update the subscription status in the database.
- Only one free trial per business (tracked in DB).

### API Endpoints

- `POST /api/business/start-trial` — Start the free trial (only once, after setup)
- `GET /api/business/subscription-status` — Get current trial/subscription status and frontend message
- `POST /api/business/create-subscription` — Create a Stripe subscription (with 14-day trial if eligible)
- (Webhook endpoint for Stripe events: see code, not public)

### Frontend Messages

- While in trial: "Your trial ends in X days."
- After trial: "Your trial has ended. Please upgrade to continue."
- If subscription is active: "Your subscription is active."

### Enforcement

- The `restrictAccess` middleware blocks access to premium features if the trial has ended and no active subscription exists.

### Environment Variables

- `STRIPE_SECRET` — Your Stripe secret key
- `STRIPE_PRICE_ID` — The Stripe price ID for the premium plan
- `STRIPE_WEBHOOK_SECRET` — The Stripe webhook signing secret
"# you-calendy-be" 
