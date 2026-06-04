using UnityEngine;
using TMPro;

public class BatterySystem : MonoBehaviour
{
    [Header("References")]
    public GameParameters gameParameters;
    public Light playerLight;
    public TMP_Text batteryText;

    [Header("Runtime")]
    public float battery = 100f;
    private bool isDraining = true;
    private bool wasDepleted = false;

    private void OnEnable()
    {
        EventBus.Subscribe<GameEvents.OnBatteryRecharged>(HandleBatteryRecharged);
    }

    private void OnDisable()
    {
        EventBus.Unsubscribe<GameEvents.OnBatteryRecharged>(HandleBatteryRecharged);
    }

    void Start()
    {
        if (gameParameters != null)
        {
            battery = gameParameters.maxBattery;
        }
    }

    void Update()
    {
        if (GameManager.Instance != null && GameManager.Instance.isPaused) return;

        float drainSpeed = gameParameters != null ? gameParameters.batteryDrainSpeed : 10f;
        float rechargeSpeed = gameParameters != null ? gameParameters.batteryRechargeSpeed : 20f;
        float maxBattery = gameParameters != null ? gameParameters.maxBattery : 100f;

        if (battery > 0 && isDraining)
        {
            battery -= drainSpeed * Time.deltaTime;

            if (battery <= 0)
            {
                battery = 0;
                if (playerLight != null)
                {
                    playerLight.enabled = false;
                }
                if (!wasDepleted)
                {
                    EventBus.Publish(new GameEvents.OnBatteryDepleted());
                    wasDepleted = true;
                }
            }
        }
        else if (battery < maxBattery && !isDraining)
        {
            battery += rechargeSpeed * Time.deltaTime;
            if (battery >= maxBattery)
            {
                battery = maxBattery;
                if (playerLight != null)
                {
                    playerLight.enabled = true;
                }
            }
        }

        if (batteryText != null)
        {
            batteryText.text = "Battery: " + Mathf.RoundToInt(battery) + "%";
        }
    }

    public void SetDraining(bool draining)
    {
        isDraining = draining;
    }

    public void AddBattery(float amount)
    {
        float maxBattery = gameParameters != null ? gameParameters.maxBattery : 100f;
        battery = Mathf.Clamp(battery + amount, 0f, maxBattery);

        if (battery > 0 && playerLight != null)
        {
            playerLight.enabled = true;
        }

        EventBus.Publish(new GameEvents.OnBatteryRecharged { amount = amount });
        wasDepleted = false;
    }

    private void HandleBatteryRecharged(GameEvents.OnBatteryRecharged evt)
    {
        Debug.Log($"Battery recharged by {evt.amount}");
    }
}
