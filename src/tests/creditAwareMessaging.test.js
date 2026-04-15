jest.mock("../utils/twilio", () => ({
  sendSMS: jest.fn(),
}));

jest.mock("../utils/sendMail", () => jest.fn());

jest.mock("../utils/creditManager", () => ({
  checkSmsCredits: jest.fn(),
  deductSmsCredits: jest.fn(),
  validateAndDeductEmailCredits: jest.fn(),
}));

const { sendSMS } = require("../utils/twilio");
const { checkSmsCredits, deductSmsCredits } = require("../utils/creditManager");
const {
  sendSMSWithCredits,
  sendBulkSMSWithCredits,
} = require("../utils/creditAwareMessaging");

describe("creditAwareMessaging SMS handling", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("does not deduct SMS credits when provider auth fails", async () => {
    checkSmsCredits.mockResolvedValue({
      hasCredits: true,
      currentCredits: 10,
      requiredCredits: 1,
    });
    sendSMS.mockRejectedValue(new Error("Authenticate"));

    const result = await sendSMSWithCredits(
      "+34600000000",
      "hello",
      "business-1"
    );

    expect(result.error).toBe(true);
    expect(result.message).toBe("Authenticate");
    expect(checkSmsCredits).toHaveBeenCalledWith("business-1", 1);
    expect(deductSmsCredits).not.toHaveBeenCalled();
  });

  test("deducts one SMS credit after a successful send", async () => {
    checkSmsCredits.mockResolvedValue({
      hasCredits: true,
      currentCredits: 10,
      requiredCredits: 1,
    });
    sendSMS.mockResolvedValue({ sid: "SM123" });
    deductSmsCredits.mockResolvedValue({
      success: true,
      remainingCredits: 9,
      deductedCredits: 1,
    });

    const result = await sendSMSWithCredits(
      "+34600000000",
      "hello",
      "business-1"
    );

    expect(result.success).toBe(true);
    expect(result.messageId).toBe("SM123");
    expect(deductSmsCredits).toHaveBeenCalledWith("business-1", 1);
  });

  test("bulk SMS deducts only successful sends", async () => {
    checkSmsCredits.mockResolvedValue({
      hasCredits: true,
      currentCredits: 10,
      requiredCredits: 2,
    });
    sendSMS
      .mockResolvedValueOnce({ sid: "SM1" })
      .mockRejectedValueOnce(new Error("Authenticate"));
    deductSmsCredits.mockResolvedValue({
      success: true,
      remainingCredits: 9,
      deductedCredits: 1,
    });

    const result = await sendBulkSMSWithCredits(
      [{ phone: "+34600000001" }, { phone: "+34600000002" }],
      "hello",
      "business-1"
    );

    expect(result.successCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(result.creditsUsed).toBe(1);
    expect(deductSmsCredits).toHaveBeenCalledWith("business-1", 1);
  });
});
