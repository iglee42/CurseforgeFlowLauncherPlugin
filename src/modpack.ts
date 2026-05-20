import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import logger from "./lib/logger";
import { NbtFile, NbtType } from "deepslate";

type MinecraftInstance = {
    guid: string;
    gameTypeID: number;
    name: string;
    profileImagePath?: string;
    timePlayed?: number;
    installedModpack?: {
        thumbnailUrl?: string;
        authors?: Array<{ name?: string }>;
    };
    manifest?: {
        version?: string;
    }
    gameVersion: string;
};

export type Modpack = {
    guid: string;
    gameTypeId: number;
    name: string;
    author: string;
    iconPath: string;
    timePlayed: number;
    version?: string;
    gameVersion: string;
    instanceFolder: string;
};

export type QuickPlayWorld = {
    type: string;
    id: string;
    name: string;
    lastPlayedTime: string;
    gamemode: string;
    iconPath: string;
};

export function formatTimePlayed(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    const remainingHours = hours % 24;
    const remainingMinutes = minutes % 60;
    const remainingSeconds = seconds % 60;

    if (days > 0) {
        return `${days}d ${remainingHours}h ${remainingMinutes}m`;
    }

    if (hours > 0) {
        return `${hours}h ${remainingMinutes}m`;
    }

    if (minutes > 0) {
        return `${minutes}m ${remainingSeconds}s`;
    }

    return `${seconds}s`;
}

export function loadModpacks(cfFolder?: string, query?: string): Modpack[] {
    if (!cfFolder) {
        return [];
    }

    const root = expandEnv(cfFolder);
    const instancesFolder = join(root, "Instances");

    if (!existsSync(instancesFolder)) {
        return [];
    }

    const entries = readdirSync(instancesFolder, { withFileTypes: true });
    const folders = entries.filter(entry => entry.isDirectory() && (!query || entry.name.toLowerCase().includes(query.toLowerCase()))).map(entry => entry.name);

    return folders
        .map(folderName => parseModpack(join(instancesFolder, folderName)))
        .filter((modpack): modpack is Modpack => modpack !== null);
}

function parseModpack(instanceFolder: string): Modpack | null {
    const jsonPath = join(instanceFolder, "minecraftinstance.json");
    if (!existsSync(jsonPath)) {
        return null;
    }

    try {
        const raw = readFileSync(jsonPath, "utf8");
        const data = JSON.parse(raw) as MinecraftInstance;

        if (!data.guid || !data.name || typeof data.gameTypeID !== "number") {
            return null;
        }

        const author = data.installedModpack?.authors?.[0]?.name || "You";

        return {
            guid: data.guid,
            gameTypeId: data.gameTypeID,
            name: data.name,
            author,
            iconPath: resolveIconPath(instanceFolder, data),
            timePlayed: data.timePlayed || 0,
            version: data.manifest?.version,
            gameVersion: data.gameVersion,
            instanceFolder: instanceFolder
        };
    } catch {
        return null;
    }
}

function resolveIconPath(instanceFolder: string, data: MinecraftInstance): string {
    if (data.profileImagePath && existsSync(data.profileImagePath)) {
        return data.profileImagePath;
    }

    const cfIcon = join(instanceFolder, "cf-modpack.ico");
    if (existsSync(cfIcon)) {
        return cfIcon;
    }

    const nameIcon = join(instanceFolder, `${data.name}.ico`);
    if (existsSync(nameIcon)) {
        return nameIcon;
    }

    if (data.installedModpack?.thumbnailUrl) {
        return data.installedModpack.thumbnailUrl;
    }

    return "assets/minecraft-custom-profile.png";
}

function expandEnv(value: string): string {
    return value.replace(/%([^%]+)%/g, (_, envName: string) => process.env[envName] || "");
}

export function getQuickPlayWorlds(modpack: Modpack, cfFolder?: string): QuickPlayWorld[] {
    if (!cfFolder) return []
    const root = expandEnv(cfFolder);
    const quickplayFolder = join(root, "Quickplay");

    if (!existsSync(quickplayFolder)) {
        return [];
    }

    const quickplayFile = join(quickplayFolder, modpack.guid + ".json")
    if (!existsSync(quickplayFile)) return [];

    try {
        const raw = readFileSync(quickplayFile, "utf8");
        const worlds = JSON.parse(raw) as QuickPlayWorld[];

        logger.info(worlds)
        return worlds.map(world => {
            return {
                ...world,
                iconPath: getQuickplayIcon(world, modpack)
            } as QuickPlayWorld
        })


    } catch {
        return [];
    }

}

function getQuickplayIcon(world: QuickPlayWorld, modpack: Modpack): string {
    if (world.type === "singleplayer") {
        const savesFolder = join(modpack.instanceFolder, "saves");
        if (!existsSync(savesFolder))
            return "assets/default.png"
        const worldFolder = join(savesFolder, world.id)
        if (!existsSync(worldFolder))
            return "assets/default.png"
        const iconFile = join(worldFolder, "icon.png");
        if (!existsSync(iconFile))
            return "assets/default.png"
        return iconFile
    } else if (world.type === "multiplayer") {
        const icon = getMultiplayerServerIcon(modpack.instanceFolder, world.id);
        if (icon) {
            return icon;
        }
    }
    return "assets/default.png"
}

function getMultiplayerServerIcon(instanceFolder: string, worldId: string): string | null {
    const serverDatFile = join(instanceFolder, "servers.dat");
    if (!existsSync(serverDatFile)) {
        return null;
    }

    try {
        const raw = readFileSync(serverDatFile);
        const bytes = new Uint8Array(raw);

        // Most servers.dat files are gzip-compressed NBT, but we keep fallbacks for robustness.
        const file = tryReadNbt(bytes);
        if (!file) {
            return null;
        }

        const servers = file.root.getList("servers", NbtType.Compound);
        const targetId = normalizeServerId(worldId);

        const server = servers
            .map(compound => ({
                ip: normalizeServerId(compound.getString("ip")),
                icon: compound.getString("icon")
            }))
            .find(entry => entry.ip === targetId);

        if (!server?.icon) {
            return null;
        }

        if (server.icon.startsWith("data:image")) {
            return server.icon;
        }

        return `data:image/png;base64,${server.icon}`;
    } catch (error) {
        logger.error(`Failed to read multiplayer icon for ${worldId}: ${String(error)}`);
        return null;
    }
}

function tryReadNbt(bytes: Uint8Array): NbtFile | null {
    try {
        return NbtFile.read(bytes);
    } catch {
        // Fallback in case file is plain NBT.
        try {
            return NbtFile.read(bytes, { compression: "none" });
        } catch {
            // Final fallback in case zlib compression is used.
            try {
                return NbtFile.read(bytes, { compression: "zlib" });
            } catch {
                return null;
            }
        }
    }
}

function normalizeServerId(value: string): string {
    return value.trim().toLowerCase();
}
