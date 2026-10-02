--[=[
	Per-player authoritative state: battery charge, flashlight on/off, leaderstats.

	The client renders optimistically and the server is the only thing that
	decides when charge actually drains, so a modified client cannot give
	itself an infinite flashlight.
]=]

local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))

local PlayerService = {}

PlayerService.states = {}
PlayerService.currentNight = 1

local config, net

local function sendState(player)
	local state = PlayerService.states[player]
	if not state or not net then
		return
	end
	net.State:FireClient(player, {
		battery = state.battery,
		maxBattery = config.Battery.Max,
		lightOn = state.lightOn,
		night = state.night,
		phase = state.phase,
		bestNight = state.bestNight and state.bestNight.Value or 0,
		nightEndsIn = state.nightEndsIn or 0,
	})
end

PlayerService.GetState = function(player)
	return PlayerService.states[player]
end

PlayerService.GetBattery = function(player)
	local state = PlayerService.states[player]
	return state and state.battery or 0
end

PlayerService.IsLightOn = function(player)
	local state = PlayerService.states[player]
	return state ~= nil and state.lightOn
end

--- 0..1 charge fraction. Drives both the HUD and the monster's repulsion.
PlayerService.GetBatteryFraction = function(player)
	local state = PlayerService.states[player]
	if not state then
		return 0
	end
	return math.clamp(state.battery / config.Battery.Max, 0, 1)
end

--- True when the player's flashlight is bright enough to drive the monster back.
PlayerService.IsLightRepelling = function(player)
	local state = PlayerService.states[player]
	if not state or not state.lightOn then
		return false
	end
	return PlayerService.GetBatteryFraction(player) > config.Monster.RepelBatteryFactor
end

PlayerService.AddBattery = function(player, amount)
	local state = PlayerService.states[player]
	if not state then
		return false
	end
	local before = state.battery
	state.battery = math.clamp(state.battery + amount, 0, config.Battery.Max)
	if state.battery > 0 and not state.lightOn then
		-- Picking up a cell while the torch is off is how players recover.
		state.lightOn = true
	end
	sendState(player)
	return state.battery > before
end

PlayerService.SetPhase = function(player, phase, night)
	local state = PlayerService.states[player]
	if not state then
		return
	end
	PlayerService.currentNight = math.max(1, night or PlayerService.currentNight)
	state.phase = phase
	state.night = PlayerService.currentNight
	if state.bestNight and PlayerService.currentNight > state.bestNight.Value then
		state.bestNight.Value = PlayerService.currentNight
	end
	sendState(player)
end

PlayerService.GetNight = function()
	return PlayerService.currentNight
end

PlayerService.SetNightEndsIn = function(player, seconds)
	local state = PlayerService.states[player]
	if state then
		state.nightEndsIn = seconds
	end
end

--- Called by MonsterService when it lands a hit.
PlayerService.OnHit = function(player, damage)
	local character = player.Character
	local humanoid = character and character:FindFirstChildOfClass("Humanoid")
	if not humanoid or humanoid.Health <= 0 then
		return
	end
	humanoid:TakeDamage(damage)
	if net then
		net.GameEvent:FireClient(player, "Hit")
	end
	if humanoid.Health <= 0 and net then
		net.GameEvent:FireClient(player, "Died")
	end
end

local function onCharacterAdded(player, character)
	local state = PlayerService.states[player]
	if not state then
		return
	end
	-- Fresh body, fresh light: the cell does not carry across deaths.
	state.battery = config.Battery.Max
	state.lightOn = false
	state.lastToggle = 0

	local humanoid = character:WaitForChild("Humanoid", 10)
	if humanoid then
		humanoid.WalkSpeed = config.Player.WalkSpeed
		humanoid.MaxHealth = config.Player.Health
		humanoid.Health = config.Player.Health
		humanoid:SetAttribute("Night99", true)
	end
	sendState(player)
end

PlayerService.OnPlayerAdded = function(player)
	if PlayerService.states[player] then
		return
	end

	local leaderstats = player:FindFirstChild("leaderstats")
	if not leaderstats then
		leaderstats = Instance.new("Folder")
		leaderstats.Name = "leaderstats"
		leaderstats.Parent = player
	end

	local function stat(name, value)
		local existing = leaderstats:FindFirstChild(name)
		if existing then
			return existing
		end
		local int = Instance.new("IntValue")
		int.Name = name
		int.Value = value
		int.Parent = leaderstats
		return int
	end

	PlayerService.states[player] = {
		battery = config.Battery.Max,
		lightOn = false,
		lastToggle = 0,
		night = 1,
		phase = "Intermission",
		nightEndsIn = 0,
		bestNight = stat("BestNight", 0),
	}

	if player.Character then
		task.spawn(onCharacterAdded, player, player.Character)
	end
	player.CharacterAdded:Connect(function(character)
		onCharacterAdded(player, character)
	end)

	sendState(player)
end

PlayerService.OnPlayerRemoving = function(player)
	PlayerService.states[player] = nil
end

local function handleLightRequest(player)
	local state = PlayerService.states[player]
	if not state then
		return
	end
	-- Rate limit: block remote-spam toggling.
	local now = os.clock()
	if now - state.lastToggle < config.Battery.ToggleCooldown then
		return
	end
	state.lastToggle = now

	-- A dead battery means no light, no matter what the client thinks.
	local canLight = state.battery > 0.5
	state.lightOn = canLight and (not state.lightOn)
	sendState(player)
end

local accumulator = 0

function PlayerService.Init(c, n)
	config = c
	net = n

	net.LightRequest.OnServerEvent:Connect(function(player)
		handleLightRequest(player)
	end)

	Players.PlayerAdded:Connect(function(player)
		PlayerService.OnPlayerAdded(player)
	end)
	Players.PlayerRemoving:Connect(function(player)
		PlayerService.OnPlayerRemoving(player)
	end)
	for _, player in Players:GetPlayers() do
		PlayerService.OnPlayerAdded(player)
	end

	-- One shared drain loop for every player.
	RunService.Heartbeat:Connect(function(dt)
		accumulator = accumulator + dt
		if accumulator < config.Battery.SyncInterval then
			return
		end
		local step = accumulator
		accumulator = 0

		local drain = config.Battery.DrainPerSecond
		local nightScale = 1 + (config.Battery.DrainGrowthPerNight * (PlayerService.GetNight() - 1))

		for player, state in pairs(PlayerService.states) do
			if state.lightOn and state.battery > 0 then
				state.battery = math.max(0, state.battery - (drain * nightScale * step))
				if state.battery <= 0 then
					state.lightOn = false
					net.GameEvent:FireClient(player, "BatteryDepleted")
				end
			elseif state.battery < config.Battery.Max then
				-- Torch off: slow trickle back, like the Unity recharge path.
				state.battery = math.min(
					config.Battery.Max,
					state.battery + (config.Battery.IdleRechargePerSecond * step)
				)
			end
			sendState(player)
		end
	end)
end

return PlayerService