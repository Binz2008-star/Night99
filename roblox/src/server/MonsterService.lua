--[=[
	Server-authoritative monster AI.

	Port of Assets/Scripts/MonsterAI.cs, with one deliberate change:

	  In Unity the monster simply flees any enabled player light, which makes
	  "hold the torch on forever" a total win. Here the flashlight only wards
	  it off while the battery is above RepelBatteryFactor. As your charge
	  falls the light shrinks, the monster closes, and you have to break for a
	  battery. Same systems, actual game.

	Line of sight is a real raycast, so trees, the cabin and the rocks are all
	usable as cover -- which is what makes the forest worth building.
]=]

local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))

local MonsterService = {}

local States = {
	Dormant = 0,
	Roaming = 1,
	Chasing = 2,
	Repelled = 3,
}
MonsterService.States = States

local config, net, players

local model, body
local state = States.Dormant
local position = Config.Map.MonsterSpawn
local facing = 0
local target = nil
local lastKnown = nil
local wanderPoint = nil
local attackCooldown = 0
local netAccumulator = 0

local rayParams = RaycastParams.new()
rayParams.FilterType = Enum.RaycastFilterType.Exclude
rayParams.IgnoreWater = true

local function isAlive(player)
	local character = player and player.Character
	local humanoid = character and character:FindFirstChildOfClass("Humanoid")
	return humanoid ~= nil and humanoid.Health > 0
end

--- Blocked by anything solid, so cover actually works.
local function hasLineOfSight(from, to)
	local delta = to - from
	local dist = delta.Magnitude
	if dist < 0.5 then
		return true
	end
	local ignored = { model }
	for _, p in Players:GetPlayers() do
		if p.Character then
			table.insert(ignored, p.Character)
		end
	end
	rayParams.FilterDescendantsInstances = ignored
	local hit = workspace:Raycast(from, delta / dist * (dist - 0.5), rayParams)
	return hit == nil
end

local function nearestPlayer()
	local best, bestDist = nil, math.huge
	for _, player in Players:GetPlayers() do
		if isAlive(player) then
			local root = player.Character:FindFirstChild("HumanoidRootPart")
			if root then
				local d = (root.Position - position).Magnitude
				if d < bestDist then
					best, bestDist = player, d
				end
			end
		end
	end
	return best, bestDist
end

local function chooseWanderPoint()
	local radius = config.Monster.ChaseRange * 0.75
	local angle = math.random() * math.pi * 2
	local dist = math.random() * radius
	return Vector3.new(
		math.clamp(position.X + math.cos(angle) * dist, -config.Map.HalfExtent, config.Map.HalfExtent),
		config.Monster.HeightOffset,
		math.clamp(position.Z + math.sin(angle) * dist, -config.Map.HalfExtent, config.Map.HalfExtent)
	)
end

local function currentSpeed()
	local base = config.Monster.ChaseSpeed + (config.Monster.ChaseSpeedPerNight * (players.GetNight() - 1))
	return math.min(base, config.Monster.MaxChaseSpeed)
end

local function repelling(player)
	return players.IsLightRepelling(player)
end

--- Where the player we are reacting to was last seen. Falls back to our own
--- position so the flee vector is never a zero-length division.
local function lastSeenPlayerPosition()
	return lastKnown or position
end

local function step(dt)
	if state == States.Dormant then
		return
	end

	local player, distance = nearestPlayer()

	-- --- decide -------------------------------------------------------------
	if player then
		local root = player.Character:FindFirstChild("HumanoidRootPart")
		local sees = hasLineOfSight(position, root.Position)

		if sees and repelling(player) and distance <= config.Monster.RepelRange then
			state = States.Repelled
			target = nil
			lastKnown = root.Position
		elseif sees and distance <= config.Monster.ChaseRange then
			state = States.Chasing
			target = player
			lastKnown = root.Position
		elseif state == States.Chasing and distance > config.Monster.GiveUpRange then
			state = States.Roaming
			target = nil
			wanderPoint = nil
		elseif state ~= States.Repelled then
			state = States.Roaming
			target = nil
		end
	end

	if state == States.Roaming and (wanderPoint == nil or (wanderPoint - position).Magnitude < 3) then
		wanderPoint = chooseWanderPoint()
	end

	-- --- move ---------------------------------------------------------------
	local goal, speed
	if state == States.Chasing and target then
		goal = target.Character:FindFirstChild("HumanoidRootPart").Position
		speed = currentSpeed()
	elseif state == States.Repelled then
		local away = position - lastSeenPlayerPosition()
		if away.Magnitude < 0.01 then
			away = Vector3.new(1, 0, 0)
		end
		goal = position + away.Unit * 10
		speed = config.Monster.RepelSpeed
	else
		goal = wanderPoint or position
		speed = config.Monster.RoamSpeed
	end

	local delta = goal - position
	delta = Vector3.new(delta.X, 0, delta.Z)
	if delta.Magnitude > 0.001 then
		local dir = delta.Unit
		position = position + dir * (speed * dt)
		-- Keep it inside the play area.
		position = Vector3.new(
			math.clamp(position.X, -config.Map.HalfExtent, config.Map.HalfExtent),
			config.Monster.HeightOffset,
			math.clamp(position.Z, -config.Map.HalfExtent, config.Map.HalfExtent)
		)
		local targetFacing = math.atan(-dir.X, -dir.Z)
		facing = facing + (targetFacing - facing) * math.min(1, dt * 8)
	end

	model:PivotTo(CFrame.new(position) * CFrame.Angles(0, facing, 0))

	-- --- attack -------------------------------------------------------------
	if target and state == States.Chasing then
		attackCooldown = math.max(0, attackCooldown - dt)
		local root = target.Character:FindFirstChild("HumanoidRootPart")
		if root and attackCooldown <= 0 and (root.Position - position).Magnitude <= config.Monster.AttackRange then
			if hasLineOfSight(position, root.Position) then
				attackCooldown = config.Monster.AttackCooldown
				players.OnHit(target, config.Monster.AttackDamage)
				-- TODO(audio): play the lunge stinger here, panned toward the player.
			end
		end
	end
end

--- Wake the monster up for a night. Always teleports it back to the pit.
function MonsterService.BeginNight()
	position = Config.Map.MonsterSpawn
	facing = math.random() * math.pi * 2
	wanderPoint = nil
	lastKnown = nil
	attackCooldown = 0
	state = States.Roaming
	if model then
		model:PivotTo(CFrame.new(position) * CFrame.Angles(0, facing, 0))
	end
end

function MonsterService.IsHunting()
	return state == States.Chasing or state == States.Repelled
end

function MonsterService.Init(c, n, p)
	config = c
	net = n
	players = p

	local workspaceNight99 = workspace:WaitForChild("Night99")
	model = workspaceNight99:WaitForChild("Monster")
	body = model:FindFirstChild("Body")
	model.PrimaryPart = body

	RunService.Heartbeat:Connect(function(dt)
		step(math.min(dt, 0.1))

		-- Broadcast the transform at a fixed rate instead of every frame.
		netAccumulator = netAccumulator + dt
		local interval = 1 / config.Monster.NetworkRate
		if netAccumulator < interval then
			return
		end
		netAccumulator = 0
		net.Monster:FireAllClients({
			position = position,
			facing = facing,
			state = state,
			hunting = MonsterService.IsHunting(),
		})
	end)
end

return MonsterService