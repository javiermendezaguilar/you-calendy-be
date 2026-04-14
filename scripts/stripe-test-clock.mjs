import Stripe from "stripe";

const stripeSecret = process.env.STRIPE_SECRET;

if (!stripeSecret) {
  console.error("Missing STRIPE_SECRET");
  process.exit(1);
}

if (!stripeSecret.startsWith("sk_test_")) {
  console.error("Refusing to run without a Stripe test secret (sk_test_*)");
  process.exit(1);
}

const stripe = new Stripe(stripeSecret);
const args = process.argv.slice(2);
const command = args[0];

const readFlag = (flagName) => {
  const index = args.indexOf(flagName);
  if (index === -1 || index === args.length - 1) {
    return undefined;
  }

  return args[index + 1];
};

const requireFlag = (flagName) => {
  const value = readFlag(flagName);
  if (!value) {
    throw new Error(`Missing required flag ${flagName}`);
  }
  return value;
};

const printUsage = () => {
  console.log(`Usage:
  npm run stripe:clock -- create --name <clock-name> [--frozen-time <unix-timestamp>]
  npm run stripe:clock -- advance --clock <clock-id> --frozen-time <unix-timestamp>
  npm run stripe:clock -- status --clock <clock-id>
  npm run stripe:clock -- delete --clock <clock-id>`);
};

const main = async () => {
  switch (command) {
    case "create": {
      const name = readFlag("--name") || "groomnest-test-clock";
      const frozenTime = readFlag("--frozen-time");

      const clock = await stripe.testHelpers.testClocks.create({
        name,
        ...(frozenTime ? { frozen_time: Number(frozenTime) } : {}),
      });

      console.log(JSON.stringify(clock, null, 2));
      return;
    }

    case "advance": {
      const clockId = requireFlag("--clock");
      const frozenTime = Number(requireFlag("--frozen-time"));

      const clock = await stripe.testHelpers.testClocks.advance(clockId, {
        frozen_time: frozenTime,
      });

      console.log(JSON.stringify(clock, null, 2));
      return;
    }

    case "status": {
      const clockId = requireFlag("--clock");
      const clock = await stripe.testHelpers.testClocks.retrieve(clockId);
      console.log(JSON.stringify(clock, null, 2));
      return;
    }

    case "delete": {
      const clockId = requireFlag("--clock");
      const clock = await stripe.testHelpers.testClocks.del(clockId);
      console.log(JSON.stringify(clock, null, 2));
      return;
    }

    default:
      printUsage();
      process.exit(command ? 1 : 0);
  }
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
