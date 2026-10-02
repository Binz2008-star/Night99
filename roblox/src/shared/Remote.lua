--[=[
	Accessor for the ReplicatedStorage folder holding Night99's RemoteEvents.

	The server creates the folder (see server/Net.lua). Everything else just
	waits on it, so this is the single place that knows the wire format.
]=]

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Remote = {}

Remote.FolderName = "Night99Net"

-- Server-safe: returns the existing folder or nil.
function Remote.TryGet()
	return ReplicatedStorage:FindFirstChild(Remote.FolderName)
end

-- Client-safe: blocks until the server has published the folder.
function Remote.Get()
	return ReplicatedStorage:WaitForChild(Remote.FolderName, 30)
end

function Remote.WaitFor(name)
	return Remote.Get():WaitForChild(name, 30)
end

return Remote