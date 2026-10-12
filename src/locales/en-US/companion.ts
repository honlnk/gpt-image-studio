type ZhCompanion = typeof import("../zh-CN/companion").default;

const companion: ZhCompanion = {
  "modeLabel": {
    "localCompanion": "Local Companion",
    "direct": "Browser Direct"
  },
  "modeSwitched": "Switched to \"{mode}\" mode.",
  "keyRejected": "Companion rejected the current connection key (it may have been reset via reset-key). The stale key has been cleared from this browser.",
  "keyRequired": "Please enter the connection key.",
  "serviceUnreachable": "Cannot reach the Companion service. Make sure it is running.",
  "keyInvalid": "The connection key is invalid. Please double-check it and try again.",
  "connectFailed": "Connection failed. Make sure Companion is online and the connection key is correct."
};

export default companion;
