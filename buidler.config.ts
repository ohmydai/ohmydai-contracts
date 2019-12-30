import { task, usePlugin } from "@nomiclabs/buidler/config";

usePlugin("@nomiclabs/buidler-truffle5");
usePlugin("@nomiclabs/buidler-ganache");
usePlugin("@nomiclabs/buidler-web3");

// This is a sample Buidler task. To learn how to create your own go to
// https://buidler.dev/guides/create-task.html
task("accounts", "Prints the list of accounts", async (taskArgs, env) => {
  const accounts = await env.web3.eth.getAccounts();

  for (const account of accounts) {
    console.log(account);
  }
});

module.exports = {};
