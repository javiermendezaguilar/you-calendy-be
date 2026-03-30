const Staff = require("../models/staff");
const Business = require("../models/User/business");
const SuccessHandler = require("../utils/SuccessHandler");
const ErrorHandler = require("../utils/ErrorHandler");
const Auditing = require("../models/auditing");
const Appointment = require("../models/appointment");
const moment = require("moment");

/**
 * @desc Validate service-specific time intervals
 * @param {Array} services - Array of service objects with timeInterval
 * @returns {Object} Validation result
 */
const validateServiceTimeIntervals = async (services) => {
  if (!services || services.length === 0) {
    return { isValid: true, message: "No services to validate" };
  }

  const invalidServices = [];

  for (const serviceItem of services) {
    const { service, timeInterval } = serviceItem;

    if (!service || !timeInterval) {
      invalidServices.push({
        serviceId: service,
        error: "Service ID and time interval are required",
      });
      continue;
    }

    if (timeInterval < 5 || timeInterval > 120) {
      invalidServices.push({
        serviceId: service,
        timeInterval: timeInterval,
        error: "Time interval must be between 5 and 120 minutes",
      });
    }
  }

  if (invalidServices.length > 0) {
    return {
      isValid: false,
      message: "Invalid service time intervals found:",
      invalidServices: invalidServices,
    };
  }

  return {
    isValid: true,
    message: "All service time intervals are valid",
  };
};

/**
 * @desc Add a new staff member to a business
 * @route POST /api/business/staff
 * @access Private (Business Owner)
 */
const addStaffMember = async (req, res) => {
  // #swagger.tags = ['Staff']
  /* #swagger.description = 'Add a new staff member to the currently logged-in user\'s business.'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['obj'] = {
        in: 'body',
        description: 'Staff member details.',
        required: true,
        schema: {
          firstName: 'John',
          lastName: 'Doe',
          email: 'john.doe@example.com',
          phone: '+1234567890',
          role: 'Barber',
          position: 'Senior Barber',
          services: [
            { service: 'serviceId1', timeInterval: 30 },
            { service: 'serviceId2', timeInterval: 45 }
          ],
          bookingBuffer: 30,
          workingHours: [{ 
            day: 'monday', 
            enabled: true, 
            shifts: [{ 
              start: '09:00', 
              end: '17:00',
              breaks: [
                {
                  start: '12:00',
                  end: '13:00',
                  description: 'Lunch Break'
                }
              ]
            }] 
          }]
        }
     }
  */
  try {
    const business = await Business.findOne({ owner: req.user.id });
    if (!business) {
      return ErrorHandler("Business not found for this user.", 404, req, res);
    }

    // Validate service-specific time intervals if services are provided
    if (req.body.services && req.body.services.length > 0) {
      const validation = await validateServiceTimeIntervals(req.body.services);
      if (!validation.isValid) {
        return ErrorHandler(
          validation.message,
          400,
          req,
          res,
          validation.invalidServices
        );
      }
    }

    const staffData = { ...req.body, business: business._id };
    const newStaff = await Staff.create(staffData);

    return SuccessHandler(newStaff, 201, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Get all staff members for a business (with search, sorting, and filtering)
 * @route GET /api/business/staff
 * @access Private (Business Owner)
 */
const getStaffMembers = async (req, res) => {
  // #swagger.tags = ['Staff']
  /* #swagger.description = 'Get all staff members for the currently logged-in user\'s business, with search, sorting, and filtering by working days and position.'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['search'] = { in: 'query', description: 'Search by name or email', type: 'string' }
     #swagger.parameters['sort'] = { in: 'query', description: 'Sort by field (e.g., name:asc, email:desc, position:asc)', type: 'string' }
     #swagger.parameters['workingDay'] = { in: 'query', description: 'Filter by working day (e.g., monday)', type: 'string' }
     #swagger.parameters['position'] = { in: 'query', description: 'Filter by position', type: 'string' }
     #swagger.parameters['page'] = { in: 'query', description: 'Page number for pagination', type: 'integer' }
     #swagger.parameters['limit'] = { in: 'query', description: 'Number of items per page', type: 'integer' }
  */
  try {
    const business = await Business.findOne({ owner: req.user.id });
    if (!business) {
      return ErrorHandler("Business not found for this user.", 404, req, res);
    }

    const {
      search,
      sort,
      workingDay,
      position,
      page = 1,
      limit = 10,
    } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    let baseQuery = { business: business._id };

    // Filter by working day
    if (workingDay) {
      baseQuery.workingHours = { $elemMatch: { day: workingDay } };
    }

    // Filter by position
    if (position) {
      baseQuery.position = position;
    }

    // Sorting
    let sortObj = {};
    if (sort) {
      // Example: firstName:asc, email:desc, position:asc
      const [field, direction] = sort.split(":");
      if (["firstName", "lastName", "email", "position"].includes(field)) {
        sortObj[field] = direction === "desc" ? -1 : 1;
      }
    } else {
      sortObj["firstName"] = 1; // Default sort by firstName ascending
    }

    // If search is provided, use aggregation for $text or $regex search
    if (search) {
      // Use $text if available, else fallback to $or with regex
      // We'll use $or with regex for more flexible search (as in getAppointmentHistory)
      const matchStage = [
        { $match: baseQuery },
        {
          $match: {
            $or: [
              { firstName: { $regex: search, $options: "i" } },
              { lastName: { $regex: search, $options: "i" } },
              { email: { $regex: search, $options: "i" } },
            ],
          },
        },
        { $sort: sortObj },
        { $skip: skip },
        { $limit: parseInt(limit) },
      ];
      const staff = await Staff.aggregate(matchStage);
      // For total count
      const totalAgg = await Staff.aggregate([
        { $match: baseQuery },
        {
          $match: {
            $or: [
              { firstName: { $regex: search, $options: "i" } },
              { lastName: { $regex: search, $options: "i" } },
              { email: { $regex: search, $options: "i" } },
            ],
          },
        },
        { $count: "total" },
      ]);
      const total = totalAgg[0] ? totalAgg[0].total : 0;
      return SuccessHandler(
        {
          staff,
          pagination: {
            total,
            page: parseInt(page),
            pages: Math.ceil(total / parseInt(limit)),
          },
        },
        200,
        res
      );
    }

    // If no search, use normal query
    const staff = await Staff.find(baseQuery)
      .sort(sortObj)
      .skip(skip)
      .limit(parseInt(limit));
    const total = await Staff.countDocuments(baseQuery);
    return SuccessHandler(
      {
        staff,
        pagination: {
          total,
          page: parseInt(page),
          pages: Math.ceil(total / parseInt(limit)),
        },
      },
      200,
      res
    );
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Get a single staff member by ID
 * @route GET /api/business/staff/:staffId
 * @access Private (Business Owner)
 */
const getStaffMemberById = async (req, res) => {
  // #swagger.tags = ['Staff']
  /* #swagger.description = 'Get a single staff member by their ID.'
       #swagger.security = [{ "Bearer": [] }]
    */
  try {
    const { staffId } = req.params;
    const business = await Business.findOne({ owner: req.user.id });
    if (!business) {
      return ErrorHandler("Business not found for this user.", 404, req, res);
    }

    const staffMember = await Staff.findOne({
      _id: staffId,
      business: business._id,
    });
    if (!staffMember) {
      return ErrorHandler("Staff member not found.", 404, req, res);
    }

    return SuccessHandler(staffMember, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Update a staff member
 * @route PUT /api/business/staff/:staffId
 * @access Private (Business Owner)
 */
const updateStaffMember = async (req, res) => {
  // #swagger.tags = ['Staff']
  /* #swagger.description = 'Update a staff member\'s details.'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['staffId'] = { in: 'path', description: 'Staff Member ID' }
     #swagger.parameters['obj'] = {
        in: 'body',
        description: 'Staff member details to update.',
        schema: {
          firstName: 'John',
          lastName: 'Doe',
          email: 'john.doe@example.com',
          services: [
            { service: 'serviceId1', timeInterval: 30 },
            { service: 'serviceId2', timeInterval: 45 }
          ],
          bookingBuffer: 45,
          workingHours: [{ 
            day: 'monday', 
            enabled: true, 
            shifts: [{ 
              start: '09:00', 
              end: '17:00',
              breaks: [
                {
                  start: '12:00',
                  end: '13:00',
                  description: 'Lunch Break'
                }
              ]
            }] 
          }]
        }
     }
  */
  try {
    const { staffId } = req.params;
    const business = await Business.findOne({ owner: req.user.id });
    if (!business) {
      return ErrorHandler("Business not found for this user.", 404, req, res);
    }

    // Validate service-specific time intervals if services are being updated
    if (req.body.services && req.body.services.length > 0) {
      const validation = await validateServiceTimeIntervals(req.body.services);
      if (!validation.isValid) {
        return ErrorHandler(
          validation.message,
          400,
          req,
          res,
          validation.invalidServices
        );
      }
    }

    const updatedStaff = await Staff.findOneAndUpdate(
      { _id: staffId, business: business._id },
      req.body,
      { new: true, runValidators: true }
    );

    if (!updatedStaff) {
      return ErrorHandler(
        "Staff member not found or you don't have permission to update.",
        404,
        req,
        res
      );
    }

    return SuccessHandler(updatedStaff, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Delete a staff member
 * @route DELETE /api/business/staff/:staffId
 * @access Private (Business Owner)
 */
const deleteStaffMember = async (req, res) => {
  // #swagger.tags = ['Staff']
  /* #swagger.description = 'Delete a staff member.'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['staffId'] = { in: 'path', description: 'Staff Member ID' }
     #swagger.parameters['reason'] = { 
        in: 'body',
        description: 'Reason for deletion',
        schema: {
          $ref: '#/definitions/DeleteStaff'
        }
     }
  */
  try {
    const { staffId } = req.params;
    const { reason } = req.body; // Get reason from request body

    if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
      return ErrorHandler("Deletion reason is required.", 400, req, res);
    }

    const business = await Business.findOne({ owner: req.user.id });
    if (!business) {
      return ErrorHandler("Business not found for this user.", 404, req, res);
    }

    const deletedStaff = await Staff.findOneAndDelete({
      _id: staffId,
      business: business._id,
    });

    if (!deletedStaff) {
      return ErrorHandler(
        "Staff member not found or you don't have permission to delete.",
        404,
        req,
        res
      );
    }

    // Create audit note
    await Auditing.create({
      entityType: "Staff",
      entityId: staffId,
      action: "deleted",
      reason: reason.trim(),
      createdBy: req.user.id,
      metadata: {
        staffName: `${deletedStaff.firstName} ${deletedStaff.lastName}`,
        businessId: business._id,
        businessName: business.name,
      },
    });

    return SuccessHandler(
      { message: "Staff member deleted successfully." },
      200,
      res
    );
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Replicate working hours schedule across all days
 * @route POST /api/business/staff/:staffId/replicate-schedule
 * @access Private (Business Owner)
 */
const replicateSchedule = async (req, res) => {
  // #swagger.tags = ['Staff']
  /* #swagger.description = 'Replicate a staff member\'s working hours schedule across all days of the week.'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['staffId'] = { in: 'path', description: 'Staff Member ID', required: true, type: 'string' }
     #swagger.parameters['obj'] = {
        in: 'body',
        description: 'Schedule replication options.',
        required: true,
        schema: {
          sourceDay: 'monday',
          targetDays: ['tuesday', 'wednesday', 'thursday', 'friday'],
          overwriteExisting: false
        }
     }
     #swagger.responses[200] = {
        description: 'Schedule replicated successfully',
        schema: {
          message: 'Schedule replicated successfully',
          replicatedDays: ['tuesday', 'wednesday', 'thursday', 'friday']
        }
     }
  */
  try {
    const { staffId } = req.params;
    const { sourceDay, targetDays, overwriteExisting = false } = req.body;

    if (!sourceDay || !targetDays || !Array.isArray(targetDays)) {
      return ErrorHandler(
        "Source day and target days array are required",
        400,
        req,
        res
      );
    }

    const business = await Business.findOne({ owner: req.user.id });
    if (!business) {
      return ErrorHandler("Business not found for this user.", 404, req, res);
    }

    const staff = await Staff.findOne({
      _id: staffId,
      business: business._id,
    });

    if (!staff) {
      return ErrorHandler("Staff member not found.", 404, req, res);
    }

    // Find the source day schedule
    const sourceSchedule = staff.workingHours.find(
      (wh) => wh.day === sourceDay
    );
    if (!sourceSchedule) {
      return ErrorHandler(
        `No schedule found for source day: ${sourceDay}`,
        404,
        req,
        res
      );
    }

    const replicatedDays = [];
    const validDays = [
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
      "sunday",
    ];

    for (const targetDay of targetDays) {
      if (!validDays.includes(targetDay)) {
        continue; // Skip invalid days
      }

      // Check if target day already has a schedule
      const existingScheduleIndex = staff.workingHours.findIndex(
        (wh) => wh.day === targetDay
      );

      if (existingScheduleIndex !== -1 && !overwriteExisting) {
        continue; // Skip if exists and not overwriting
      }

      // Create new schedule based on source
      const newSchedule = {
        day: targetDay,
        enabled: sourceSchedule.enabled,
        shifts: sourceSchedule.shifts.map((shift) => ({
          start: shift.start,
          end: shift.end,
          breaks: shift.breaks
            ? shift.breaks.map((breakPeriod) => ({
                start: breakPeriod.start,
                end: breakPeriod.end,
                description: breakPeriod.description,
              }))
            : [],
        })),
      };

      if (existingScheduleIndex !== -1) {
        // Update existing schedule
        staff.workingHours[existingScheduleIndex] = newSchedule;
      } else {
        // Add new schedule
        staff.workingHours.push(newSchedule);
      }

      replicatedDays.push(targetDay);
    }

    await staff.save();

    return SuccessHandler(
      {
        message: "Schedule replicated successfully",
        replicatedDays,
        sourceDay,
        totalReplicated: replicatedDays.length,
      },
      200,
      res
    );
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Get working hours for a specific staff member with available time slots
 * @route GET /api/business/staff/:staffId/working-hours
 * @access Private (Business Owner)
 */
const getWorkingHoursByStaffId = async (req, res) => {
  // #swagger.tags = ['Staff']
  /* #swagger.description = 'Get working hours for a specific staff member with available time slots calculated based on service-specific timeInterval, existing appointments, booking buffer, and current time. Returns ALL possible time slots based on staff\'s default timeInterval when no serviceId is provided, or service-specific slots when serviceId is provided. Automatically filters out past time slots and respects booking buffer to prevent last-minute bookings.'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['staffId'] = { in: 'path', description: 'Staff Member ID', required: true, type: 'string' }
     #swagger.parameters['date'] = { in: 'query', description: 'Date to get working hours for (YYYY-MM-DD). If not provided, returns all working hours.', type: 'string' }
     #swagger.parameters['serviceId'] = { in: 'query', description: 'Service ID to calculate service-specific time slots for. If not provided, returns ALL possible time slots based on default timeInterval.', type: 'string' }
     #swagger.responses[200] = {
        description: 'Working hours with available time slots (excluding past slots and slots within booking buffer for today)',
        schema: {
          staff: {
            _id: 'staffId',
            firstName: 'John',
            lastName: 'Doe',
            timeInterval: 15,
            bookingBuffer: 30,
            workingHours: [
              {
                day: 'monday',
                enabled: true,
                shifts: [{ start: '09:00', end: '17:00' }],
                availableSlots: ['09:00', '09:15', '09:30', '09:45', '10:00', '10:15', '10:30', '10:45', '11:00', '11:15', '11:30', '11:45', '12:00', '12:15', '12:30', '12:45', '13:00', '13:15', '13:30', '13:45', '14:00', '14:15', '14:30', '14:45', '15:00', '15:15', '15:30', '15:45', '16:00', '16:15', '16:30', '16:45']
              }
            ]
          }
        }
     }
  */
  try {
    const { staffId } = req.params;
    const { date, serviceId } = req.query;

    let business = null;
    let staff = null;

    if (req.user?.id) {
      business = await Business.findOne({ owner: req.user.id });
      if (!business) {
        return ErrorHandler("Business not found for this user.", 404, req, res);
      }

      staff = await Staff.findOne({
        _id: staffId,
        business: business._id,
      }).populate("business", "_id owner businessHours hours");

      if (!staff) {
        return ErrorHandler("Staff member not found.", 404, req, res);
      }

      if (!staff.business) {
        staff.business = business;
      }
    } else {
      staff = await Staff.findById(staffId).populate(
        "business",
        "_id owner businessHours hours"
      );

      if (!staff) {
        return ErrorHandler("Staff member not found.", 404, req, res);
      }

      if (!staff.business) {
        return ErrorHandler(
          "Business not found for this staff member.",
          404,
          req,
          res
        );
      }

      business = staff.business;
    }

    // If no date provided, return working hours without slot calculation
    if (!date) {
      return SuccessHandler(
        {
          staff: {
            _id: staff._id,
            firstName: staff.firstName,
            lastName: staff.lastName,
            timeInterval: staff.timeInterval,
            workingHours: staff.workingHours,
          },
        },
        200,
        res
      );
    }

    const requestedDate = moment(date);
    const dayName = requestedDate.format("dddd").toLowerCase();

    // Find the working hours for the requested day
    const daySchedule = staff.workingHours.find((wh) => wh.day === dayName);

    if (!daySchedule || !daySchedule.enabled) {
      return SuccessHandler(
        {
          staff: {
            _id: staff._id,
            firstName: staff.firstName,
            lastName: staff.lastName,
            timeInterval: staff.timeInterval,
            workingHours: [
              {
                day: dayName,
                enabled: false,
                shifts: [],
                availableSlots: [],
              },
            ],
          },
        },
        200,
        res
      );
    }

    // Generate time slots for each shift based on service-specific timeInterval or default
    const workingHoursWithSlots = {
      ...daySchedule.toObject(),
      availableSlots: [],
    };

    // Determine the time interval to use
    let timeInterval = staff.timeInterval || 15; // Default to 15 minutes if not set

    // If serviceId is provided, find the service-specific time interval
    if (serviceId) {
      const serviceItem = staff.services.find(
        (s) => s.service.toString() === serviceId
      );
      if (serviceItem) {
        timeInterval = serviceItem.timeInterval;
      }
    }

    // Generate ALL possible time slots for each shift based on timeInterval
    daySchedule.shifts.forEach((shift) => {
      const start = moment(shift.start, "HH:mm");
      const end = moment(shift.end, "HH:mm");

      // Generate slots every timeInterval minutes
      while (start.isBefore(end)) {
        // Check if this slot conflicts with any breaks
        const slotTime = start.format("HH:mm");
        const isInBreak =
          shift.breaks &&
          shift.breaks.some((breakPeriod) => {
            const breakStart = moment(breakPeriod.start, "HH:mm");
            const breakEnd = moment(breakPeriod.end, "HH:mm");
            const slotMoment = moment(slotTime, "HH:mm");
            return (
              slotMoment.isSameOrAfter(breakStart) &&
              slotMoment.isBefore(breakEnd)
            );
          });

        if (!isInBreak) {
          workingHoursWithSlots.availableSlots.push(slotTime);
        }
        start.add(timeInterval, "minutes");
      }
    });

    // If no serviceId provided, return working hours with all possible slots
    if (!serviceId) {
      return SuccessHandler(
        {
          staff: {
            _id: staff._id,
            firstName: staff.firstName,
            lastName: staff.lastName,
            timeInterval: staff.timeInterval,
            workingHours: [workingHoursWithSlots],
          },
        },
        200,
        res
      );
    }

    // Get service-specific time interval for duration calculation
    const serviceItem = staff.services.find(
      (s) => s.service.toString() === serviceId
    );
    if (!serviceItem) {
      return ErrorHandler(
        "Service not assigned to this staff member",
        404,
        req,
        res
      );
    }
    const serviceDuration = serviceItem.timeInterval;

    // Filter slots to only include those that can accommodate the service duration
    const serviceCompatibleSlots = workingHoursWithSlots.availableSlots.filter(
      (slot) => {
        const slotStart = moment(slot, "HH:mm");
        const slotEnd = slotStart.clone().add(serviceDuration, "minutes");

        // Check if the slot can fit the service duration within the shift
        return daySchedule.shifts.some((shift) => {
          const shiftStart = moment(shift.start, "HH:mm");
          const shiftEnd = moment(shift.end, "HH:mm");
          return (
            slotStart.isSameOrAfter(shiftStart) &&
            slotEnd.isSameOrBefore(shiftEnd)
          );
        });
      }
    );

    // Update the available slots with service-compatible slots
    workingHoursWithSlots.availableSlots = serviceCompatibleSlots;

    // Get existing appointments for this staff member on this date
    const appointmentQuery = {
      staff: staffId,
      date: { $eq: requestedDate.startOf("day").toDate() },
      status: { $nin: ["Canceled", "No-Show"] },
    };

    if (business?._id) {
      appointmentQuery.business = business._id;
    }

    const bookedAppointments = await Appointment.find(appointmentQuery);

    // Filter out booked slots
    let availableSlots = workingHoursWithSlots.availableSlots.filter((slot) => {
      const slotStart = moment(slot, "HH:mm");
      const slotEnd = slotStart.clone().add(serviceDuration, "minutes");

      return !bookedAppointments.some((appt) => {
        const apptStart = moment(appt.startTime, "HH:mm");
        const apptEnd = moment(appt.endTime, "HH:mm");

        // Check for overlap: (SlotStart, SlotEnd) overlaps with (ApptStart, ApptEnd)
        return slotStart.isBefore(apptEnd) && slotEnd.isAfter(apptStart);
      });
    });

    // Apply past time filter (always filter out past slots)
    const currentTime = moment();
    const requestedDateMoment = moment(requestedDate);

    // Filter out past time slots
    availableSlots = availableSlots.filter((slot) => {
      const slotDateTime = requestedDateMoment.clone().set({
        hour: parseInt(slot.split(":")[0], 10),
        minute: parseInt(slot.split(":")[1], 10),
        second: 0,
        millisecond: 0,
      });

      // Only show slots that are in the future
      return slotDateTime.isAfter(currentTime);
    });

    // Apply booking buffer filter
    if (staff.bookingBuffer > 0) {
      // Only apply buffer for today's appointments
      if (requestedDateMoment.isSame(currentTime, "day")) {
        availableSlots = availableSlots.filter((slot) => {
          const slotDateTime = requestedDateMoment.clone().set({
            hour: parseInt(slot.split(":")[0], 10),
            minute: parseInt(slot.split(":")[1], 10),
            second: 0,
            millisecond: 0,
          });

          const timeDifference = slotDateTime.diff(currentTime, "minutes");
          return timeDifference >= staff.bookingBuffer;
        });
      }
    }

    workingHoursWithSlots.availableSlots = availableSlots;

    return SuccessHandler(
      {
        staff: {
          _id: staff._id,
          firstName: staff.firstName,
          lastName: staff.lastName,
          timeInterval: staff.timeInterval,
          bookingBuffer: staff.bookingBuffer,
          workingHours: [workingHoursWithSlots],
        },
      },
      200,
      res
    );
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

module.exports = {
  addStaffMember,
  getStaffMembers,
  getStaffMemberById,
  updateStaffMember,
  deleteStaffMember,
  replicateSchedule,
  getWorkingHoursByStaffId,
};
