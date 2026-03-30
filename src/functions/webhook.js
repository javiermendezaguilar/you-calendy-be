// const Chat = require("../models/Chat/chat");
// const Team = require("../models/League/team");
const Billing = require("../models/User/billing");
const Notification = require("../models/User/notification");
const User = require("../models/User/user");
const { getUserDetail } = require("../utils");
const adminNotification = require("../utils/adminNotification");
const sendNotification = require("../utils/pushNotification");
const dotenv = require("dotenv");
dotenv.config({ path: "./config/config.env" });

async function handlePayment(status, payload, other) {
  try {
    const { type, userId, teamId, leagueId, notificationId } = payload;

    const { amount, id, billing_details } = other;

    if (status === "success") {
      await Billing.create({
        user: userId,
        team: teamId,
        league: leagueId,
        amount: amount / 100,
        invoice: id,
        billingDetail: billing_details,
        type,
      });
      if(notificationId) {
        await Notification.findOneAndUpdate(
          { _id: notificationId },
          {
            $set: {
              type: "payment",
            },
          }
        );
      }
      // send noti for mutliple admins
      const admin = await User.findOne({ role: "admin" });

      /* Commented out due to missing Team module
      const [team, user] = await Promise.all([
        Team.findById(teamId),
        User.findById(userId),
      ]);
      */
      
      // Modified to only fetch user
      const user = await User.findById(userId);
      // Create placeholder for team name
      const team = { name: "Team" };

      const userDetail = getUserDetail(user);

      const notificationData = {
        ...userDetail,
        teamId,
      };

      if (type === "create") {
        /* Commented out due to missing Team module
        await Team.findOneAndUpdate(
          { _id: teamId },
          {
            $set: {
              isPaid: true,
            },
          },
          {
            new: true,
          }
        );
        */
        
        /* Commented out due to missing Chat module
        // create chat here
        await Chat.create({
          team: teamId,
          league: leagueId,
        });
        */
        
        //    send to admin
        // await sendNotification(
        //   admin,
        //   "Payment Received",
        //   `${user.name} has paid to join the team: ${team.name}.`,
        //   "payment",
        //   notificationData
        // );
        await adminNotification(
          admin,
          "Payment Received",
          `${user.name} has paid to join the team: ${team.name}.`,
          "payment",
          notificationData
        );
        return true;
      } else if (type === "changeLeague") {
        /* Commented out due to missing Team module
        await Team.findOneAndUpdate(
          { _id: teamId },
          {
            $set: {
              league: leagueId,
              isArchived: false,
            },
          }
        );
        */
        
        //    send to admin
        // await sendNotification(
        //   admin,
        //   "Payment Received",
        //   `${user.name} has paid to join the team: ${team.name}.`,
        //   "payment",
        //   notificationData
        // );
        await adminNotification(
          admin,
          "Payment Received",
          `${user.name} has paid to join the team: ${team.name}.`,
          "payment",
          notificationData
        );
        return true;
      } else if (type === "join") {
        /* Commented out due to missing Team module
        const invitedPlayerEntry = team.invitedPlayers.find(
          (entry) => entry.player.toString() === userId.toString()
        );

        const jerseyNumber = invitedPlayerEntry
          ? invitedPlayerEntry.jerseyNumber
          : null;

        const updateData = {
          $pull: { invitedPlayers: { player: userId } },
          $push: {
            players: {
              player: userId,
              jerseyNumber: jerseyNumber,
            },
          },
        };

        if (team.captain) {
          await Team.findOneAndUpdate(
            {
              _id: team,
            },
            updateData
          );
          const captain = await User.findById(team.captain);

          //   send to captain
          await sendNotification(
            captain,
            "Team Update",
            `${user.name} has now joined the team: ${team.name}.`,
            "joined",
            notificationData
          );
        } else {
          await Team.findOneAndUpdate(
            {
              _id: team,
            },
            {
              ...updateData,
              $set: {
                captain: userId,
              },
            }
          );
        }
        */

        //    send to admin
        // await sendNotification(
        //   admin,
        //   "Payment Received",
        //   `${user.name} has paid to join the team: ${team.name}.`,
        //   "payment",
        //   notificationData
        // );
        await adminNotification(
          admin,
          "Payment Received",
          `${user.name} has paid to join the team: ${team.name}.`,
          "payment",
          notificationData
        );
        return true;
      }
    }
  } catch (error) {
    console.log("error", error);
    return error;
  }
}
module.exports = { handlePayment };
