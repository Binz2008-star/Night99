--[=[
	Creates the Night99 RemoteEvent folder in ReplicatedStorage.

	Direction of every channel:
	  State        server -> one player   battery / light / night snapshot
	  Monster      server -> everyone      monster transform + AI state, 15Hz
	  LightRequest client -> server        "toggle my flashlight"
	  GameEvent    server -> one player    night banners, hits, death
]=]

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Remote = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Remote"))

local Net = {}

function Net.Create()
	local existing = Remote.TryGet()
	if existing then
		existing:Destroy()
	end

	local folder = Instance.new("Folder")
	folder.Name = Remote.FolderName
	folder.Parent = ReplicatedStorage

	local function add(className, remoteName)
		local remote = Instance.new(className)
		remote.Name = remoteName
		remote.Parent = folder
		Net[remoteName] = remote
		return remote
	end

	add("RemoteEvent", "State")
	add("RemoteEvent", "Monster")
	add("RemoteEvent", "LightRequest")
	add("RemoteEvent", "GameEvent")

	return folder
end

return Net