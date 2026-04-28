jest.mock("../utils/twilio", () => ({
  sendSMS: jest.fn(),
}));

jest.mock("../utils/sendMail", () => jest.fn());

jest.mock("../utils/creditManager", () => ({
  checkSmsCredits: jest.fn(),
  checkEmailCredits: jest.fn(),
  deductSmsCredits: jest.fn(),
  deductEmailCredits: jest.fn(),
  addSmsCredits: jest.fn(),
  addEmailCredits: jest.fn(),
  validateAndDeductEmailCredits: jest.fn(),
}));

const { sendSMS } = require("../utils/twilio");
const sendMail = require("../utils/sendMail");
const {
  deductSmsCredits,
  deductEmailCredits,
  addSmsCredits,
  addEmailCredits,
} = require("../utils/creditManager");
const {
  sendSMSWithCredits,
  sendEmailWithCredits,
  sendBulkSMSWithCredits,
  sendBulkEmailWithCredits,
} = require("../utils/creditAwareMessaging");

describe("creditAwareMessaging SMS handling", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("refunds reserved SMS credit when provider auth fails", async () => {
    deductSmsCredits.mockResolvedValue({
      success: true,
      remainingCredits: 9,
      deductedCredits: 1,
    });
    addSmsCredits.mockResolvedValue({
      success: true,
      totalCredits: 10,
      addedCredits: 1,
    });
    sendSMS.mockRejectedValue(new Error("Authenticate"));

    const result = await sendSMSWithCredits(
      "+34600000000",
      "hello",
      "business-1"
    );

    expect(result.error).toBe(true);
    expect(result.message).toBe("Authenticate");
    expect(deductSmsCredits).toHaveBeenCalledWith("business-1", 1);
    expect(addSmsCredits).toHaveBeenCalledWith("business-1", 1);
  });

  test("deducts one SMS credit after a successful send", async () => {
    deductSmsCredits.mockResolvedValue({
      success: true,
      remainingCredits: 9,
      deductedCredits: 1,
    });
    sendSMS.mockResolvedValue({ sid: "SM123" });

    const result = await sendSMSWithCredits(
      "+34600000000",
      "hello",
      "business-1"
    );

    expect(result.success).toBe(true);
    expect(result.messageId).toBe("SM123");
    expect(deductSmsCredits).toHaveBeenCalledWith("business-1", 1);
    expect(addSmsCredits).not.toHaveBeenCalled();
  });

  test("bulk SMS reserves recipients and refunds failed sends", async () => {
    deductSmsCredits.mockResolvedValue({
      success: true,
      remainingCredits: 8,
      deductedCredits: 2,
    });
    addSmsCredits.mockResolvedValue({
      success: true,
      totalCredits: 9,
      addedCredits: 1,
    });
    sendSMS
      .mockResolvedValueOnce({ sid: "SM1" })
      .mockRejectedValueOnce(new Error("Authenticate"));

    const result = await sendBulkSMSWithCredits(
      [{ phone: "+34600000001" }, { phone: "+34600000002" }],
      "hello",
      "business-1"
    );

    expect(result.successCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(result.creditsUsed).toBe(1);
    expect(result.creditsRefunded).toBe(1);
    expect(deductSmsCredits).toHaveBeenCalledWith("business-1", 2);
    expect(addSmsCredits).toHaveBeenCalledWith("business-1", 1);
  });

  test("bulk Email reserves recipients and refunds failed sends", async () => {
    deductEmailCredits.mockResolvedValue({
      success: true,
      remainingCredits: 8,
      deductedCredits: 2,
    });
    addEmailCredits.mockResolvedValue({
      success: true,
      totalCredits: 9,
      addedCredits: 1,
    });
    sendMail
      .mockResolvedValueOnce({ messageId: "E1" })
      .mockRejectedValueOnce(new Error("SMTP auth"));

    const result = await sendBulkEmailWithCredits(
      [{ email: "one@example.com" }, { email: "two@example.com" }],
      "subject",
      "hello",
      "business-1"
    );

    expect(result.successCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(result.creditsUsed).toBe(1);
    expect(result.creditsRefunded).toBe(1);
    expect(deductEmailCredits).toHaveBeenCalledWith("business-1", 2);
    expect(addEmailCredits).toHaveBeenCalledWith("business-1", 1);
  });

  test("refunds reserved Email credit when provider auth fails", async () => {
    deductEmailCredits.mockResolvedValue({
      success: true,
      remainingCredits: 9,
      deductedCredits: 1,
    });
    addEmailCredits.mockResolvedValue({
      success: true,
      totalCredits: 10,
      addedCredits: 1,
    });
    sendMail.mockRejectedValue(new Error("SMTP auth"));

    const result = await sendEmailWithCredits(
      "one@example.com",
      "subject",
      "hello",
      "business-1"
    );

    expect(result.error).toBe(true);
    expect(result.message).toBe("SMTP auth");
    expect(deductEmailCredits).toHaveBeenCalledWith("business-1", 1);
    expect(addEmailCredits).toHaveBeenCalledWith("business-1", 1);
  });

  test("bulk SMS does not call provider when credit reservation fails", async () => {
    deductSmsCredits.mockRejectedValue(new Error("Insufficient SMS credits"));

    const result = await sendBulkSMSWithCredits(
      [{ phone: "+34600000001" }, { phone: "+34600000002" }],
      "hello",
      "business-1"
    );

    expect(result.error).toBe(true);
    expect(result.message).toBe("Insufficient SMS credits");
    expect(sendSMS).not.toHaveBeenCalled();
  });
});
