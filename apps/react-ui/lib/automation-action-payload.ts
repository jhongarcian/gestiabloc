import type { AutomationAction } from "../app/(tenants)/app/[tenantSlug]/account-settings/_components/automation-types.js"

export function serializeAutomationAction(action: AutomationAction): AutomationAction {
  const base = {
    nodeKey: action.nodeKey,
    type: action.type,
  }

  switch (action.type) {
    case "UPDATE_CONTACT_CUSTOM_FIELDS":
      return { ...base, customFieldUpdates: action.customFieldUpdates }
    case "SET_CONTACT_STATUS":
      return { ...base, statusConfigId: action.statusConfigId }
    case "SET_CONTACT_ASSIGNEE":
      return { ...base, assignedUserId: action.assignedUserId }
    case "CLEAR_CONTACT_ASSIGNEE":
    case "DELETE_CONTACT":
      return base
    case "ADD_CONTACT_TAG":
    case "REMOVE_CONTACT_TAG":
      return { ...base, tagId: action.tagId }
    case "ADD_CONTACT_NOTE":
      return { ...base, noteTitle: action.noteTitle, noteBody: action.noteBody }
    case "CREATE_CONTACT":
      return { ...base, createContactConfig: action.createContactConfig }
    case "CREATE_TASK":
      return { ...base, taskConfig: action.taskConfig }
    case "FORMAT_DATE_TIME":
      return { ...base, dateTimeFormatterConfig: action.dateTimeFormatterConfig }
    case "FORMAT_NUMBER":
      return { ...base, numberFormatterConfig: action.numberFormatterConfig }
    case "FORMAT_TEXT":
      return { ...base, textFormatterConfig: action.textFormatterConfig }
    case "MATH_OPERATION":
      return { ...base, mathOperationConfig: action.mathOperationConfig }
    case "WAIT":
      return { ...base, waitConfig: action.waitConfig }
    case "IF_ELSE":
      return {
        ...base,
        ifElseConfig: action.ifElseConfig
          ? {
              ...action.ifElseConfig,
              branches: action.ifElseConfig.branches.map((branch) => ({
                ...branch,
                actions: branch.actions.map(serializeAutomationAction),
              })),
            }
          : action.ifElseConfig,
      }
    case "SPLIT":
      return {
        ...base,
        splitConfig: action.splitConfig
          ? {
              ...action.splitConfig,
              routes: action.splitConfig.routes.map((route) => ({
                ...route,
                actions: route.actions.map(serializeAutomationAction),
              })),
            }
          : action.splitConfig,
      }
    case "GO_TO":
      return { ...base, goToConfig: action.goToConfig }
    case "ADD_TO_WORKFLOW":
      return { ...base, addToWorkflowConfig: action.addToWorkflowConfig }
    case "REMOVE_FROM_WORKFLOW":
      return { ...base, removeFromWorkflowConfig: action.removeFromWorkflowConfig }
    case "UPDATE_OPPORTUNITY":
      return { ...base, opportunityConfig: action.opportunityConfig }
    case "DELETE_OPPORTUNITY":
      return { ...base, deleteOpportunityConfig: action.deleteOpportunityConfig }
  }
}
