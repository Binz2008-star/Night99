--[=[
	Night 99 client entry point.

	Waits for the server to publish the wire format, then brings up the HUD
	first (the flashlight needs its touch button) before starting the systems.
]=]

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Remote = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Remote"))

local Client = script.Parent

local HUD = require(Client:WaitForChild("HUD"))
local Flashlight = require(Client:WaitForChild("Flashlight"))
local MonsterClient = require(Client:WaitForChild("MonsterClient"))
local CameraRig = require(Client:WaitForChild("CameraRig"))

local net = {
	State = Remote.WaitFor("State"),
	Monster = Remote.WaitFor("Monster"),
	GameEvent = Remote.WaitFor("GameEvent"),
}

HUD.Init(net, MonsterClient)
Flashlight.Init(net, HUD.ToggleButton())
MonsterClient.Init(net)
CameraRig.Init()