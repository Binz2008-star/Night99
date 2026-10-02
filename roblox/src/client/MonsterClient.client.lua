--[=[
	Read-only mirror of the monster's server state.

	Does not move the monster -- that is owned by MonsterService on the server.
	This only caches the last position for the HUD's proximity warning, and
	pulses the eye glow client-side because light is pure presentation.
]=]

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))

local MonsterClient = {}

local player = Players.LocalPlayer
local position = Vector3.zero
local hunting = false
local lastState = 0
local eyes = {}

function MonsterClient.IsHunting()
	return hunting
end

--- Raw AI state id, matching MonsterService.States on the server.
function MonsterClient.State()
	return lastState
end

function MonsterClient.Distance()
	local character = player.Character
	local root = character and character:FindFirstChild("HumanoidRootPart")
	if not root then
		return math.huge
	end
	return (position - root.Position).Magnitude
end

--- 0 when far away, 1 when it is right on top of you.
function MonsterClient.Proximity()
	local distance = MonsterClient.Distance()
	if distance == math.huge then
		return 0
	end
	local start = Config.Monster.ChaseRange
	if distance >= start then
		return 0
	end
	return math.clamp(1 - (distance / start), 0, 1)
end

local function updateEyes()
	-- The glow is only visible up close, and it beats faster the closer it is.
	local proximity = MonsterClient.Proximity()
	local base = 0.6 + proximity * 3.2
	for _, light in ipairs(eyes) do
		light.Brightness = base
		light.Range = 8 + proximity * 10
	end
end

function MonsterClient.Init(net)
	local model = workspace:WaitForChild("Night99"):WaitForChild("Monster")
	for _, descendant in ipairs(model:GetDescendants()) do
		if descendant:IsA("PointLight") then
			table.insert(eyes, descendant)
		end
	end

	net.Monster.OnClientEvent:Connect(function(packet)
		position = packet.position
		hunting = packet.hunting
		lastState = packet.state
	end)

	task.spawn(function()
		while model and model.Parent do
			updateEyes()
			task.wait(0.1)
		end
	end)
end

return MonsterClient