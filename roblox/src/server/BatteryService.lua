--[=[
	Battery pickups.

	Every Neon part named BatteryPickup_* in the map gets a ProximityPrompt at
	runtime, so the map stays pure geometry and you can move or add pickups in
	Studio without touching code.
]=]

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))

local BatteryService = {}

local config, net, players
local prompts = {}

local function respawnAfter(part, delay)
	task.delay(delay, function()
		if part.Parent then
			part.Transparency = 0
			for _, prompt in prompts[part] do
				prompt.Enabled = true
			end
		end
	end)
end

local function onTriggered(player, part)
	local gained = players.AddBattery(player, config.Battery.PickupAmount)
	if not gained then
		return
	end
	if net then
		net.GameEvent:FireClient(player, "BatteryPickup", config.Battery.PickupAmount)
		-- TODO(audio): play the cell-recharge click here.
	end

	part.Transparency = 0.85
	for _, prompt in prompts[part] do
		prompt.Enabled = false
	end
	respawnAfter(part, config.Battery.PickupRespawnSeconds)
end

function BatteryService.Init(c, n, p)
	config = c
	net = n
	players = p

	local landmarks = workspace:WaitForChild("Night99"):WaitForChild("Landmarks")
	local pickups = landmarks:WaitForChild("BatteryPickups")

	for _, part in ipairs(pickups:GetChildren()) do
		if part:IsA("BasePart") then
			local prompt = Instance.new("ProximityPrompt")
			prompt.Name = "PickupPrompt"
			prompt.ActionText = "Grab cell"
			prompt.ObjectText = "Battery"
			prompt.KeyboardKeyCode = Enum.KeyCode.E
			prompt.HoldDuration = 0.35
			prompt.MaxActivationDistance = 10
			prompt.RequiresLineOfSight = false
			prompt.Parent = part

			prompts[part] = { prompt }
			prompt.Triggered:Connect(function(player)
				onTriggered(player, part)
			end)
		end
	end
end

function BatteryService.Count()
	local count = 0
	for _ in pairs(prompts) do
		count = count + 1
	end
	return count
end

return BatteryService