import open from "open";
import { z } from "zod";
import { Flow, JSONRPCResponse } from "./lib/flow";
import { formatTimePlayed, loadModpacks, Modpack } from "./modpack";

type Settings = {
	cfFolder?: string;
};

const events = ["launch_modpack", "context_menu"] as const;
type Events = (typeof events)[number];

const flow = new Flow<Events, Settings>("assets/curseforge-logo.png");

flow.on("query", (params) => {

	const [queryRaw = ""] = z.array(z.string()).parse(params);
	const query = queryRaw.trim().toLowerCase();
	const results = [];
	const modpacks = loadModpacks(flow.settings.cfFolder, query);
	const settings = flow.settings;


	for (const modpack of modpacks) {
		if (!modpack.name.toLowerCase().startsWith(query)) {
			continue;
		}

		results.push({
			title: modpack.name,
			subtitle: `${modpack.version ? `${modpack.version} | ` : ""}By ${modpack.author} | Time Played : ${formatTimePlayed(modpack.timePlayed)} | ${modpack.gameVersion}`,
			method: "launch_modpack",
			parameters: [modpack.guid, modpack.gameTypeId],
			iconPath: modpack.iconPath,
			context: [modpack, settings]
		} as JSONRPCResponse<Events>);
	}
	flow.showResult(...results);
});

flow.on("context_menu", (params) => {
	const [modpack] = params[0] as [Modpack,Settings];
	const results = [] as JSONRPCResponse<Events>[];

	results.push({
		title: `Launch ${modpack.name}`,
		subtitle: `${modpack.version ? `${modpack.version} | ` : ""}By ${modpack.author} | Time Played : ${formatTimePlayed(modpack.timePlayed)} | ${modpack.gameVersion}`,
		method: "launch_modpack",
		parameters: [modpack.guid, modpack.gameTypeId],
		iconPath: modpack.iconPath
	} as JSONRPCResponse<Events>);


	// TODO : Add the quickplay worlds when curseforge add deeplink's parameter for them
	/*const quickplayWorld = getQuickPlayWorlds(modpack, settings?.cfFolder || "")
	quickplayWorld.sort((a, b) => {
		return new Date(b.lastPlayedTime).getTime() -
			new Date(a.lastPlayedTime).getTime();
	}).forEach(world => {
		results.push({
			title: world.name,
			subtitle: `${world.type}${world.type === "multiplayer"? ` Ip: ${world.id}` : ''} | Last Played : ${new Date(world.lastPlayedTime).toLocaleString()}`,
			iconPath: world.iconPath
		} as JSONRPCResponse<Events>);
	 })*/

	flow.showResult(...results)
})

flow.on("launch_modpack", (params) => {
	const [guid, gameTypeId] = z.tuple([z.string(), z.number()]).parse(params);
	const launchUrl = `curseforge://launch-game?instanceId=${guid}&gameId=${gameTypeId}`;
	open(launchUrl);
});

flow.run();
