using UnityEngine;

[CreateAssetMenu(fileName = "GameParameters", menuName = "Game/Game Parameters")]
public class GameParameters : ScriptableObject
{
    [Header("Player Movement")]
    public float playerSpeed = 5f;
    public float rotationSpeed = 10f;

    [Header("Battery System")]
    public float maxBattery = 100f;
    public float batteryDrainSpeed = 10f;
    public float batteryRechargeSpeed = 20f;
    public float batteryPickupAmount = 25f;
    public float lightIntensity = 10f;
    public float lightRange = 20f;

    [Header("Monster AI")]
    public float monsterSpeed = 3f;
    public float monsterChaseRange = 30f;
    public float monsterFleeLightRange = 15f;
    public float monsterDamageRange = 2f;

    [Header("Camera")]
    public float cameraDistance = 10f;
    public float cameraHeight = 15f;
    public float cameraSmoothSpeed = 5f;
}
