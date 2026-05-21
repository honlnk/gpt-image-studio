import { program } from "commander";

program
  .name("gpt-image-studio")
  .description("GPT Image Studio 本地 CLI Companion")
  .version("0.0.0");

program
  .command("serve")
  .description("启动本地 companion HTTP 服务")
  .option("-p, --port <port>", "监听端口", "19750")
  .action(async (opts) => {
    const { startServer } = await import("./server");
    await startServer({ port: Number(opts.port) });
  });

program
  .command("login")
  .description("配置 API 凭据")
  .action(async () => {
    console.log("login: 尚未实现");
  });

program
  .command("status")
  .description("查看 companion 状态")
  .action(async () => {
    console.log("status: 尚未实现");
  });

program
  .command("logout")
  .description("清除已保存的凭据")
  .action(async () => {
    console.log("logout: 尚未实现");
  });

program.parse();
