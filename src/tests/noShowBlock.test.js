const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const jwt = require('jsonwebtoken');

// Set environment variables before requiring app
process.env.JWT_SECRET = 'mysecretcalendy';
process.env.MONGO_URI = 'mock-uri';

const app = require('../app');
const Client = require('../models/client');
const User = require('../models/User/user');
const Business = require('../models/User/business');
const Appointment = require('../models/appointment');
const Staff = require('../models/staff');

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = mongoServer.getUri();
  // Override mongoose connection for testing
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  await mongoose.connect(uri);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('No-Show Booking Block Enforcement', () => {
  let business, barber, blockedClient, normalClient, service, staff;
  let blockedToken, normalToken, barberToken;

  beforeEach(async () => {
    // Clear collections
    await Promise.all([
      Client.deleteMany({}),
      User.deleteMany({}),
      Business.deleteMany({}),
      Staff.deleteMany({}),
      Appointment.deleteMany({})
    ]);

    // 1. Create Business Owner (Barber)
    barber = await User.create({
      name: 'Barber One',
      firstName: 'Barber',
      lastName: 'One',
      email: 'barber@example.com',
      password: 'password123',
      role: 'barber',
      isEmailVerified: true
    });

    // 2. Create Business
    business = await Business.create({
      owner: barber._id,
      name: 'Test Barbershop',
      businessName: 'Test Barbershop',
      contactInfo: { phone: '+12223334444' },
      services: [{ 
        name: 'Cut', 
        duration: 30, 
        price: 20,
        isActive: true 
      }]
    });
    service = business.services[0];

    // 3. Create Staff
    staff = await Staff.create({
      firstName: 'Staff',
      lastName: 'One',
      business: business._id,
      services: [{ service: service._id, timeInterval: 30 }],
      isActive: true
    });

    // 4. Create Clients
    blockedClient = await Client.create({
      firstName: 'Blocked',
      lastName: 'Client',
      phone: '+15556667777',
      business: business._id,
      appBookingBlocked: true,
      lastNoShowDate: new Date('2024-01-01T10:00:00Z'),
      registrationStatus: 'registered',
      isProfileComplete: true,
      isActive: true
    });

    normalClient = await Client.create({
      firstName: 'Normal',
      lastName: 'Client',
      phone: '+18889990000',
      business: business._id,
      appBookingBlocked: false,
      registrationStatus: 'registered',
      isProfileComplete: true,
      isActive: true
    });

    // 5. Generate Tokens
    blockedToken = jwt.sign({ id: blockedClient._id, role: 'client', businessId: business._id }, process.env.JWT_SECRET);
    normalToken = jwt.sign({ id: normalClient._id, role: 'client', businessId: business._id }, process.env.JWT_SECRET);
    barberToken = jwt.sign({ id: barber._id, role: 'barber' }, process.env.JWT_SECRET);
  });

  test('should reject booking from a blocked client', async () => {
    const res = await request(app)
      .post('/appointments')
      .set('Authorization', `Bearer ${blockedToken}`)
      .send({
        businessId: business._id.toString(),
        serviceId: service._id.toString(),
        staffId: staff._id.toString(),
        date: new Date(),
        startTime: '10:00',
        endTime: '10:30'
      });

    expect(res.status).toBe(403);
    // Message should reference the no-show date and business phone
    expect(res.body.message).toContain('Due to an unexcused no-show on 01/01/2024');
    expect(res.body.message).toContain('+12223334444');
  });

  test('should allow booking from a non-blocked client', async () => {
    const res = await request(app)
      .post('/appointments')
      .set('Authorization', `Bearer ${normalToken}`)
      .send({
        businessId: business._id.toString(),
        serviceId: service._id.toString(),
        staffId: staff._id.toString(),
        date: new Date(),
        startTime: '11:00',
        endTime: '11:30'
      });

    // Note: It might fail later in the controller due to missing twilio/stripe setup, 
    // but it should PASS the block check middleware.
    // If it reaches the controller, it usually returns 201 or 400 (if validation fails).
    // The important part is it shouldn't be 403 with the block message.
    expect(res.status).not.toBe(403);
  });

  test('should allow booking immediately after being unblocked', async () => {
    // 1. Verify client is initially blocked
    const firstAttempt = await request(app)
      .post('/appointments')
      .set('Authorization', `Bearer ${blockedToken}`)
      .send({
        businessId: business._id.toString(),
        serviceId: service._id.toString(),
        staffId: staff._id.toString(),
        date: new Date(),
        startTime: '12:00',
        endTime: '12:30'
      });
    expect(firstAttempt.status).toBe(403);

    // 2. Barber unblocks the client
    const unblockRes = await request(app)
      .put(`/business/clients/${blockedClient._id}/unblock`)
      .set('Authorization', `Bearer ${barberToken}`);
    
    expect(unblockRes.status).toBe(200);

    // 3. Client tries to book again
    const secondAttempt = await request(app)
      .post('/appointments')
      .set('Authorization', `Bearer ${blockedToken}`)
      .send({
        businessId: business._id.toString(),
        serviceId: service._id.toString(),
        staffId: staff._id.toString(),
        date: new Date(),
        startTime: '14:00',
        endTime: '14:30'
      });

    // Should no longer be 403 Blocked
    expect(secondAttempt.status).not.toBe(403);
  });
});
