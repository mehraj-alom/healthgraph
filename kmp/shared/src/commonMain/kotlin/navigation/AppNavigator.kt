package com.healthgraph.shared.navigation

import androidx.compose.runtime.Composable
import com.adamkobus.voyager.Voyager
import com.healthgraph.shared.ui.screens.*

sealed interface Screen : com.adamkobus.voyager.Screen {
    data object Dashboard : Screen
    data object HealthAreas : Screen
    data object Body : Screen
    data object Timeline : Screen
    data object Priority : Screen
    data object FitnessEngine : Screen
    data object WeightEngine : Screen
    data object SleepEngine : Screen
    data object WellbeingEngine : Screen
    data object DisciplineEngine : Screen
    data object HeartEngine : Screen
    data object NutritionEngine : Screen
    data object Recovery : Screen
    data object Cycle : Screen
    data object Medications : Screen
    data object Documents : Screen
    data object FoodScan : Screen
    data object VitalsLogger : Screen
    data object Substance : Screen
    data object Meditation : Screen
    data object PpgMeasure : Screen
    data object VoiceCheckin : Screen
    data object VoiceJournal : Screen
    data object Chat : Screen
    data object Settings : Screen
    data object Onboarding : Screen
    data object Profile : Screen
    data object Insights : Screen
    data object Trends : Screen
    data object Report : Screen
}

@Composable
fun AppNavigator(voyager: Voyager) {
    voyager.registerScreen(Screen.Dashboard) { DashboardScreen() }
    voyager.registerScreen(Screen.HealthAreas) { HealthAreasScreen() }
    voyager.registerScreen(Screen.Body) { BodyScreen() }
    voyager.registerScreen(Screen.Timeline) { TimelineScreen() }
    voyager.registerScreen(Screen.Priority) { PriorityScreen() }
    voyager.registerScreen(Screen.FitnessEngine) { FitnessEngineScreen() }
    voyager.registerScreen(Screen.WeightEngine) { WeightEngineScreen() }
    voyager.registerScreen(Screen.SleepEngine) { SleepEngineScreen() }
    voyager.registerScreen(Screen.WellbeingEngine) { WellbeingEngineScreen() }
    voyager.registerScreen(Screen.DisciplineEngine) { DisciplineEngineScreen() }
    voyager.registerScreen(Screen.HeartEngine) { HeartEngineScreen() }
    voyager.registerScreen(Screen.NutritionEngine) { NutritionEngineScreen() }
    voyager.registerScreen(Screen.Recovery) { RecoveryScreen() }
    voyager.registerScreen(Screen.Cycle) { CycleScreen() }
    voyager.registerScreen(Screen.Medications) { MedicationsScreen() }
    voyager.registerScreen(Screen.Documents) { DocumentsScreen() }
    voyager.registerScreen(Screen.FoodScan) { FoodScanScreen() }
    voyager.registerScreen(Screen.VitalsLogger) { VitalsLoggerScreen() }
    voyager.registerScreen(Screen.Substance) { SubstanceScreen() }
    voyager.registerScreen(Screen.Meditation) { MeditationScreen() }
    voyager.registerScreen(Screen.PpgMeasure) { PpgMeasureScreen() }
    voyager.registerScreen(Screen.VoiceCheckin) { VoiceCheckinScreen() }
    voyager.registerScreen(Screen.VoiceJournal) { VoiceJournalScreen() }
    voyager.registerScreen(Screen.Chat) { ChatScreen() }
    voyager.registerScreen(Screen.Settings) { SettingsScreen() }
    voyager.registerScreen(Screen.Onboarding) { OnboardingScreen() }
    voyager.registerScreen(Screen.Profile) { ProfileScreen() }
    voyager.registerScreen(Screen.Insights) { InsightsScreen() }
    voyager.registerScreen(Screen.Trends) { TrendsScreen() }
    voyager.registerScreen(Screen.Report) { ReportScreen() }
}

@Composable
fun BottomNavigationBar(voyager: Voyager) {
    val tabs = listOf(
        NavigationTab(Screen.Dashboard, "Dashboard", androidx.compose.material.icons.Icons.Default.Home),
        NavigationTab(Screen.HealthAreas, "Health", androidx.compose.material.icons.Icons.Default.Favorite),
        NavigationTab(Screen.Body, "Body", androidx.compose.material.icons.Icons.Default.AccessibilityNew),
        NavigationTab(Screen.Timeline, "Timeline", androidx.compose.material.icons.Icons.Default.Timeline),
        NavigationTab(Screen.Priority, "Priority", androidx.compose.material.icons.Icons.Default.Flag),
    )
    
    com.adamkobus.voyager.BottomNavigation(
        voyager = voyager,
        tabs = tabs,
        modifier = androidx.compose.ui.Modifier.fillMaxWidth()
    ) { tab, selected ->
        com.healthgraph.shared.ui.components.BottomNavTab(
            tab = tab,
            selected = selected,
            onClick = { voyager.push(tab.screen) }
        )
    }
}

data class NavigationTab(
    val screen: Screen,
    val label: String,
    val icon: androidx.compose.ui.graphics.vector.ImageVector
)

@Composable
fun AppNavHost(voyager: Voyager = rememberVoyager()) {
    AppNavigator(voyager)
    voyager.navHost()
}

@Composable
private fun rememberVoyager(): Voyager {
    return remember { Voyager() }
}