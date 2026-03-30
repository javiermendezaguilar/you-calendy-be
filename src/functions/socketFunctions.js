const addUser = async (user, socket) => {
  const index = global.onlineUsers.findIndex((user2) => {
    return user2.user == user;
  });
  if (index == -1) {
    global.onlineUsers.push({ user, socket, date: Date.now() });
  } else {
    global.onlineUsers[index].socket = socket;
  }
};

const removeUser = async (socket) => {
  const removedUser = global.onlineUsers.find((user) => {
    return user.socket == socket;
  });
  global.onlineUsers = global.onlineUsers.filter((user) => {
    return user.socket !== socket;
  });
  console.log("removed user", removedUser);
};

const sendMessageSocket = async (user, message) => {
  console.log("sendMessageSocket", user, message);
  const index = global.onlineUsers.findIndex((user2) => {
    return user2.user == user;
  });
  if (index !== -1) {
    global.io.to(global.onlineUsers[index].socket).emit("message", message);
  }
};

const unreadCountSocket = async (user, count) => {
  const index = global.onlineUsers.findIndex((user2) => {
    return user2.user == user;
  });
  console.log("unreadCountSocket", index);
  if (index !== -1) {
    global.io.to(global.onlineUsers[index].socket).emit("unreadCount", count);
  }
};

const seenSocket = async (user, data) => {
  const index = global.onlineUsers.findIndex((user2) => {
    return user2.user == user;
  });
  console.log("seenSocket", index);
  if (index !== -1) {
    global.io.to(global.onlineUsers[index].socket).emit("seen", data);
  }
};

const adminNotificationSocket = async (user, data) => {
  const index = global.onlineUsers.findIndex((user2) => {
    return user2.user == user;
  });
  if (index !== -1) {
    console.log(global.onlineUsers[index]);
    global.io.to(global.onlineUsers[index].socket).emit("adminNotification", {
      title: data.title,
      message: data.message,
      type: data.type,
      data: data.data,
    });
    console.log("adminNotification sent to user", user);
  }
};

module.exports = {
  addUser,
  removeUser,
  sendMessageSocket,
  unreadCountSocket,
  seenSocket,
  adminNotificationSocket,
};
