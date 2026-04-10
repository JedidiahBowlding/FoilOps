export class HelpMessages {
  static generalHelp = `
How to use <b>FoilOps Wallet Tracker Bot: </b>

🔮 Main Commands:
/start - Open main menu
/add - Add wallet(s)
/delete - Delete wallets(s)
/manage - Manage all your tracked wallets
/upgrade - Upgrade your FoilOps plan

🆘 Help Commands:
/help_notify - How to use FoilOps notifications
/help_group - How to add FoilOps to group chats
`

  static groupsHelp = `
<b>How to add FoilOps to Telegram groups:</b>

1️⃣ Add FoilOps as an administrator in your Group chat
2️⃣ Send /start in the Group Chat
3️⃣ Send /activate | after this only the person who activated the bot will be able to add or delete wallets
4️⃣ Send /add to start adding wallets
`

  static notifyHelp = `
<b>How to use FoilOps Bot:</b>
1️⃣ Send /start
2️⃣ Click on <b>Add</b> Button
3️⃣ Paste the address you want to track

<b>Understand FoilOps notifications:</b>
<b>@</b> - Token Price
<b>MC</b> - Token Market Cap
<b>HOLDS</b> - Amount of tokens and supply percentage this wallet holds
`
}
